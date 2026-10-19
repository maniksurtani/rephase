import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';

import 'data/local_repository.dart';
import 'data/mobile_api.dart';
import 'data/models.dart';
import 'data/session_store.dart';
import 'engine/mobile_engine.dart';

/// Application state and the native adapter to the existing account contract.
/// Planning, itinerary validation, calendar and merging stay in the shared engine.
class AppController extends ChangeNotifier with WidgetsBindingObserver {
  AppController({
    required this.engine,
    LocalRepository? repository,
    MobileApi? api,
    SessionStore? sessionStore,
    GoogleIdentity? identity,
    DateTime Function()? clock,
  }) : _repository = repository ?? FileLocalRepository(),
       _api = api ?? HttpMobileApi(),
       _sessionStore = sessionStore ?? SecureSessionStore(),
       _identity = identity ?? GoogleSignInIdentity(),
       _clock = clock ?? DateTime.now;

  final MobileEngine engine;
  final LocalRepository _repository;
  final MobileApi _api;
  final SessionStore _sessionStore;
  final GoogleIdentity _identity;
  final DateTime Function() _clock;

  AppData? _data;
  AccountSession? _session;
  AccountSession? _signOutSession;
  bool _signOutNeedsRetry = false;
  CloudSnapshot? _baseline;
  CloudSnapshot? _conflictCloud;
  Json _catalog = {};
  Json? _mobilePlan;
  Json _config = {};
  bool _pending = false;
  bool _busy = false;
  bool _planning = false;
  bool _disposed = false;
  bool _initialized = false;
  bool _authRejected = false;
  bool _foreground = true;
  int _epoch = 0;
  int _planGeneration = 0;
  String? _lastPlanningInput;
  Future<void>? _syncing;
  Timer? _timer;
  String? _error;
  String? _notice;
  List<String> _conflicts = [];

  AppData? get data => _data;
  Preferences? get preferences => _data?.preferences;
  List<Trip> get trips => _data?.trips ?? const [];
  Trip? get selectedTrip =>
      trips.where((trip) => trip.id == _data?.selectedTripId).firstOrNull ??
      trips.firstOrNull;
  Account? get account => _session?.account;
  Json get catalog => _catalog;
  Json? get mobilePlan => _mobilePlan;
  DateTime get now => _clock();
  bool get busy => _busy;
  bool get planning => _planning;
  bool get signedIn => _session != null;
  bool get signOutNeedsRetry => _signOutNeedsRetry;
  bool get needsSignIn =>
      _session != null && (_authRejected || !_session!.validAt(now));
  bool get pendingSave => _pending;
  List<String> get conflicts => List.unmodifiable(_conflicts);
  String? get error => _error;
  String? get notice => _notice;
  void clearFeedback() {
    _error = null;
    _notice = null;
    _notify();
  }

  bool get flightLookupAvailable => _config['flightLookupAvailable'] == true;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int epoch) => !_disposed && epoch == _epoch;
  String _message(Object error) => error is ApiException
      ? error.message
      : error is FormatException
      ? error.message
      : error
            .toString()
            .replaceFirst('Bad state: ', '')
            .replaceFirst('Exception: ', '');
  AppData _empty() => AppData.fromJson({
    'schemaVersion': 1,
    'preferences': _catalog['defaultPreferences'],
    'trips': <Json>[],
    'selectedTripId': null,
  });
  bool _same(AppData? a, AppData? b) {
    dynamic canonical(dynamic value) => value is Map
        ? {
            for (final key
                in value.keys.map((k) => k.toString()).toList()..sort())
              key: canonical(value[key]),
          }
        : value is List
        ? value.map(canonical).toList()
        : value;
    return jsonEncode(canonical(a?.json)) == jsonEncode(canonical(b?.json));
  }

  bool _contentChanged(AppData a, AppData b) =>
      !_same(a.copy(selectedTripId: null), b.copy(selectedTripId: null));

  Future<Json> engineCall(String operation, [Json payload = const {}]) =>
      engine.call(operation, payload);

  Future<void> initialize() async {
    if (_initialized || _busy) return;
    _busy = true;
    _notify();
    final epoch = _epoch;
    try {
      _catalog = await engine.call('bootstrap');
      if (!_current(epoch)) return;
      final restoredSession = await _sessionStore.read();
      if (!_current(epoch)) return;
      _session = restoredSession;
      final saved = await _repository.read(account?.id);
      if (!_current(epoch)) return;
      if (saved != null) {
        await _validateData(saved.data);
        if (saved.baseline?.data != null) {
          await _validateData(saved.baseline!.data!);
        }
        if (!_current(epoch)) return;
        _data = saved.data;
        _baseline = saved.baseline;
        _pending = saved.pending;
      } else {
        _data = _empty();
      }
      _initialized = true;
      WidgetsBinding.instance.addObserver(this);
      _timer = Timer.periodic(const Duration(minutes: 1), (_) {
        if (!_foreground) return;
        _notify();
        if (!_planning) unawaited(_replan(presentationOnly: true));
        // Retry only outstanding edits, while visible. Connectivity plugins do
        // not prove that the API is reachable; this bounded retry does.
        if (_pending &&
            !_busy &&
            _syncing == null &&
            !needsSignIn &&
            _conflicts.isEmpty) {
          unawaited(_sync(_epoch));
        }
      });
      await _replan();
      if (_session != null) await _sync(epoch);
      unawaited(_loadConfig());
    } catch (error) {
      if (_current(epoch)) _error = _message(error);
    } finally {
      if (_current(epoch)) {
        _busy = false;
        _notify();
      }
    }
  }

  Future<void> _loadConfig() async {
    try {
      _config = await _api.config();
      _notify();
    } catch (_) {
      /* Guest and offline planning do not require the API. */
    }
  }

  Future<void> _validateData(AppData data) async {
    final result = await engine.call('validateData', {'data': data.toJson()});
    if (result['valid'] != true) {
      throw FormatException(
        result['error'] as String? ??
            'Saved data has an unsupported format. The copy was preserved.',
      );
    }
  }

  Future<void> _replan({bool presentationOnly = false}) async {
    final trip = selectedTrip;
    final prefs = preferences;
    final generation = ++_planGeneration;
    final epoch = _epoch;
    if (trip == null || prefs == null) {
      _mobilePlan = null;
      _lastPlanningInput = null;
      _planning = false;
      _notify();
      return;
    }
    final planningPreferences = prefs.toJson()
      ..remove('loungeMemberships')
      ..remove('loungePriority')
      ..remove('calendarAlarms')
      ..remove('autoSync')
      ..remove('melatoninAcknowledged');
    final planningInput = jsonEncode({
      'trip': trip.json,
      'preferences': planningPreferences,
    });
    final cachedPlan = _mobilePlan?['plan'];
    final reuse = cachedPlan is Map && planningInput == _lastPlanningInput;
    if (presentationOnly && !reuse) return;
    _planning = true;
    _notify();
    try {
      final result = await engine.call(reuse ? 'view' : 'plan', {
        if (reuse) 'plan': cachedPlan,
        'trip': trip.toJson(),
        'preferences': prefs.toJson(),
        'now': now.millisecondsSinceEpoch,
      });
      if (_current(epoch) && generation == _planGeneration) {
        _mobilePlan = result;
        _lastPlanningInput = planningInput;
      }
    } catch (error) {
      if (_current(epoch) && generation == _planGeneration) {
        _error = _message(error);
      }
    } finally {
      if (_current(epoch) && generation == _planGeneration) {
        _planning = false;
        _notify();
      }
    }
  }

  Future<void> _persist(int epoch) async {
    if (!_current(epoch) || _data == null) return;
    final id = account?.id;
    final state = CachedState(
      data: _data!,
      baseline: _baseline,
      pending: _pending,
    );
    await _repository.write(id, state);
  }

  Future<void> _commit(AppData next, {bool content = true}) async {
    final epoch = _epoch;
    _data = next;
    if (signedIn && content) _pending = true;
    _error = null;
    _notice = null;
    _notify();
    try {
      await _persist(epoch);
    } catch (error) {
      if (_current(epoch)) {
        _error = 'Could not save on this device: ${_message(error)}';
        _notify();
      }
      rethrow;
    }
    if (!_current(epoch)) return;
    await _replan();
    if (_current(epoch) && signedIn && _pending) unawaited(_sync(epoch));
  }

  void _canEdit() {
    if (_busy || _data == null) {
      throw StateError('Please wait for your account to finish loading.');
    }
  }

  Future<void> savePreferences(Preferences next) async {
    _canEdit();
    final epoch = _epoch;
    await _validateData(_data!.copy(preferences: next));
    if (!_current(epoch)) return;
    await _commit(_data!.copy(preferences: next));
  }

  Future<void> saveTrip(Trip trip) async {
    _canEdit();
    final epoch = _epoch;
    final validation = await engine.call('validateTrip', {
      'trip': trip.toJson(),
    });
    if (!_current(epoch)) return;
    final existing = trips
        .where((existing) => existing.id == trip.id)
        .firstOrNull;
    if (existing != null && existing.updatedAt != trip.updatedAt) {
      throw StateError(
        'This trip changed while you were editing it. Reopen it to keep the latest flight details.',
      );
    }
    if (validation['valid'] != true) {
      throw StateError(
        (validation['errors'] as List? ?? ['Check the flight details.']).join(
          '\n',
        ),
      );
    }
    final updated = trip.withChanges({
      'updatedAt': now.toUtc().toIso8601String(),
    });
    final found = trips.any((existing) => existing.id == trip.id);
    await _commit(
      _data!.copy(
        trips: found
            ? trips
                  .map(
                    (existing) => existing.id == trip.id ? updated : existing,
                  )
                  .toList()
            : [...trips, updated],
        selectedTripId: trip.id,
      ),
    );
  }

  Future<void> deleteTrip(String id) async {
    _canEdit();
    final remaining = trips.where((trip) => trip.id != id).toList();
    await _commit(
      _data!.copy(
        trips: remaining,
        selectedTripId: _data!.selectedTripId == id
            ? remaining.firstOrNull?.id
            : _data!.selectedTripId,
      ),
    );
  }

  Future<void> selectTrip(String id) async {
    _canEdit();
    if (!trips.any((trip) => trip.id == id)) return;
    await _commit(_data!.copy(selectedTripId: id), content: false);
  }

  Future<void> loadExample() async => saveTrip(
    Trip.fromJson((_catalog['demoTrip'] as Map).cast<String, dynamic>()),
  );

  Future<void> recordAction(Json record) async {
    final tripId = record['tripId'] as String? ?? selectedTrip?.id;
    final trip = trips.where((trip) => trip.id == tripId).firstOrNull;
    if (trip == null) return;
    final nextRecord = {
      ...record,
      'tripId': trip.id,
      'recordedAt': record['recordedAt'] ?? now.toUtc().toIso8601String(),
    };
    final updated = trip.withChanges({
      'adherence': [
        ...trip.adherence.where(
          (item) => item['actionId'] != record['actionId'],
        ),
        nextRecord,
      ],
    });
    await saveTrip(updated);
  }

  Future<Json> lookupFlight(
    String flightNumber,
    String date, {
    String? departureAirport,
  }) async {
    final session = _authenticated();
    try {
      return await _api.lookupFlight(
        session,
        flightNumber,
        date,
        departureAirport: departureAirport,
      );
    } on ApiException catch (error) {
      if (error.status == 401) {
        _authRejected = true;
        _notice =
            'Sign in again to look up flights. Your saved trips are still available.';
        _notify();
      }
      rethrow;
    }
  }

  Future<Json> exploreLounges(Json payload) => engine.call('lounges', {
    'preferences': preferences?.toJson(),
    'now': now.millisecondsSinceEpoch,
    ...payload,
  });

  AccountSession _authenticated() {
    final session = _session;
    if (session == null || needsSignIn) {
      throw StateError(
        'Sign in with Google to continue. Your trips remain available offline.',
      );
    }
    return session;
  }

  Future<void> signIn() async {
    if (_busy) return;
    _busy = true;
    _error = null;
    _notify();
    final epoch = ++_epoch;
    _planGeneration++;
    _planning = false;
    try {
      final config = await _api.config();
      if (!_current(epoch)) return;
      final serverClientId = const String.fromEnvironment(
        'GOOGLE_SERVER_CLIENT_ID',
      );
      final resolvedServerId = serverClientId.isNotEmpty
          ? serverClientId
          : config['googleClientId'] as String?;
      if (resolvedServerId == null || resolvedServerId.isEmpty) {
        throw StateError('Google sign-in is not configured for this build.');
      }
      const clientId = String.fromEnvironment('GOOGLE_IOS_CLIENT_ID');
      // A deliberate sign-in starts fresh. An ambiguous network exchange is
      // reported instead of silently retrying authentication.
      await _identity.signOut();
      if (!_current(epoch)) return;
      final credential = await _identity.authenticate(
        serverClientId: resolvedServerId,
        clientId: clientId.isEmpty ? null : clientId,
      );
      if (credential == null || !_current(epoch)) return;
      final session = await _api.exchange(credential);
      if (!_current(epoch)) return;
      final saved = await _repository.read(session.account.id);
      if (saved != null) await _validateData(saved.data);
      if (saved?.baseline?.data != null) {
        await _validateData(saved!.baseline!.data!);
      }
      if (!_current(epoch)) return;
      // Never copy the guest namespace into a signed-in account.
      await _sessionStore.write(session);
      if (!_current(epoch)) return;
      _session = session;
      _signOutSession = null;
      _signOutNeedsRetry = false;
      _authRejected = false;
      _data = saved?.data ?? _empty();
      _mobilePlan = null;
      _lastPlanningInput = null;
      _baseline = saved?.baseline;
      _pending = saved?.pending ?? false;
      _conflicts = [];
      _conflictCloud = null;
      _config = config;
      await _sync(epoch);
      await _replan();
    } catch (error) {
      if (_current(epoch)) _error = _message(error);
    } finally {
      if (_current(epoch)) {
        _busy = false;
        if (_mobilePlan == null && selectedTrip != null) unawaited(_replan());
        _notify();
      }
    }
  }

  Future<void> signOut() async {
    final previous = _session ?? _signOutSession;
    final epoch = ++_epoch;
    _busy = true;
    _session = null;
    _authRejected = false;
    _data = null;
    _baseline = null;
    _pending = false;
    _mobilePlan = null;
    _conflicts = [];
    _conflictCloud = null;
    _error = null;
    _notice = null;
    _notify();
    final failures = <String>[];
    try {
      try {
        await _sessionStore.write(null);
        _signOutSession = null;
        _signOutNeedsRetry = false;
      } catch (_) {
        _signOutSession = previous;
        _signOutNeedsRetry = true;
        failures.add(
          'This device could not remove its saved sign-in. Retry signing out before sharing the device.',
        );
      }
      CachedState? guest;
      try {
        guest = await _repository.read(null);
        if (guest != null) await _validateData(guest.data);
      } catch (error) {
        guest =
            null; // Preserve an unsupported file without displaying its contents.
        failures.add('Could not load guest data: ${_message(error)}');
      }
      if (!_current(epoch)) return;
      _data = guest?.data ?? _empty();
      await _replan();
      try {
        await _identity.signOut();
      } catch (_) {
        /* Local session is already removed. */
      }
      if (previous != null) {
        try {
          await _api.logout(previous);
        } catch (_) {
          /* The revoked local token is not reused; server expiry remains bounded. */
        }
      }
    } catch (error) {
      if (_current(epoch)) {
        _data ??= _empty();
        failures.add(_message(error));
      }
    } finally {
      if (_current(epoch)) {
        if (failures.isNotEmpty) _error = failures.join('\n');
        _busy = false;
        _notify();
      }
    }
  }

  Future<void> refresh() async {
    _error = null;
    final epoch = _epoch;
    if (signedIn) await _sync(epoch);
    if (_current(epoch)) await _replan();
    unawaited(_loadConfig());
  }

  Future<void> retrySave() => refresh();

  Future<void> _sync(int epoch) async {
    if (!_current(epoch) || _session == null || _data == null) return;
    if (_syncing != null) {
      await _syncing;
      if (_current(epoch) && _pending && _conflicts.isEmpty) {
        return _sync(epoch);
      }
      return;
    }
    final completion = Completer<void>();
    _syncing = completion.future;
    try {
      final session = _authenticated();
      if (_conflicts.isNotEmpty) return;
      final identity = await _api.account(session);
      if (!_current(epoch)) return;
      if (identity.id != session.account.id) {
        throw StateError('Account identity changed. Sign in again.');
      }
      for (var attempt = 0; attempt < 2; attempt++) {
        final cloud = await _api.getState(session);
        if (!_current(epoch)) return;
        if (cloud.data != null) await _validateData(cloud.data!);
        if (!_current(epoch)) return;
        final local = _data!;
        final baseline = _baseline;
        AppData merged;
        if (!_pending || _same(local, cloud.data)) {
          // Cloud deletion is authoritative unless this device has pending edits.
          merged = cloud.data ?? _empty();
        } else if (cloud.data == null) {
          if (baseline?.data != null ||
              (baseline != null && cloud.revision > baseline.revision)) {
            _setConflict(cloud, [
              'Account data was deleted on another device.',
            ]);
            return;
          }
          merged = local;
        } else if (baseline?.data == null) {
          _setConflict(cloud, [
            'This device has edits without a shared account history.',
          ]);
          return;
        } else {
          final result = await engine.call('merge', {
            'base': baseline!.data!.toJson(),
            'local': local.toJson(),
            'remote': cloud.data!.toJson(),
          });
          if (!_current(epoch)) return;
          final conflicts = (result['conflicts'] as List? ?? [])
              .whereType<String>()
              .toList();
          if (conflicts.isNotEmpty) {
            _setConflict(cloud, conflicts);
            return;
          }
          merged = AppData.fromJson(
            (result['data'] as Map).cast<String, dynamic>(),
          );
        }
        final sent = local;
        var accepted = cloud;
        if (_pending &&
            !_same(merged, cloud.data) &&
            (cloud.data == null || _contentChanged(merged, cloud.data!))) {
          try {
            final revision = await _api.putState(
              session,
              merged,
              cloud.revision,
            );
            accepted = CloudSnapshot(data: merged, revision: revision);
          } on ApiException catch (error) {
            if (error.status == 409 && attempt == 0) continue;
            rethrow;
          }
        }
        if (!_current(epoch)) return;
        var next = merged;
        var pending = false;
        // Preserve edits made while GET/PUT was in flight, including trip deletion.
        if (!_same(sent, _data)) {
          for (var foldAttempt = 0; foldAttempt < 3; foldAttempt++) {
            final latest = _data!;
            final folded = await engine.call('merge', {
              'base': sent.toJson(),
              'local': latest.toJson(),
              'remote': merged.toJson(),
            });
            if (!_current(epoch)) return;
            if (!_same(latest, _data)) {
              if (foldAttempt < 2) continue;
              _baseline = accepted;
              _setConflict(accepted, [
                'More edits arrived during saving. Review before continuing.',
              ]);
              await _persist(epoch);
              return;
            }
            final conflicts = (folded['conflicts'] as List? ?? [])
                .whereType<String>()
                .toList();
            _baseline = accepted;
            if (conflicts.isNotEmpty) {
              _setConflict(accepted, conflicts);
              await _persist(epoch);
              return;
            }
            next = AppData.fromJson(
              (folded['data'] as Map).cast<String, dynamic>(),
            );
            pending =
                accepted.data == null || _contentChanged(next, accepted.data!);
            break;
          }
        }
        // Preserve local navigation when another device's selection differs.
        if (next.trips.any((trip) => trip.id == _data?.selectedTripId)) {
          next = next.copy(selectedTripId: _data!.selectedTripId);
        }
        _data = next;
        _baseline = accepted;
        _pending = pending;
        _notice = pending
            ? 'Changes saved on this device; saving to your account…'
            : null;
        _error = null;
        await _persist(epoch);
        if (_current(epoch)) await _replan();
        return;
      }
    } catch (error) {
      if (_current(epoch)) {
        if (error is ApiException && error.status == 401) _authRejected = true;
        _notice = error is ApiException && error.status == 401 || needsSignIn
            ? 'Sign in again to save changes to your account. Your device copy is preserved.'
            : _pending
            ? 'Changes saved on this device. Account saving will resume when you reconnect.'
            : 'Showing your saved device copy. Pull to refresh when connected.';
        if (error is FormatException) _error = _message(error);
      }
    } finally {
      _syncing = null;
      completion.complete();
      _notify();
    }
  }

  void _setConflict(CloudSnapshot cloud, List<String> conflicts) {
    _conflictCloud = cloud;
    _conflicts = conflicts;
    _notice =
        'Changes on another device need your review. Your device copy is preserved.';
    _notify();
  }

  /// Explicit resolution is the only path that may replace a conflicting copy.
  Future<void> resolveConflict({required bool useLocal}) async {
    final cloud = _conflictCloud;
    if (cloud == null) return;
    final epoch = _epoch;
    _baseline = cloud;
    _conflicts = [];
    _conflictCloud = null;
    if (useLocal) {
      // The chosen cloud snapshot becomes the common baseline for a CAS save.
      _pending = true;
    } else {
      _data = cloud.data ?? _empty();
      _pending = false;
    }
    await _persist(epoch);
    await _replan();
    if (_current(epoch) && useLocal) await _sync(epoch);
  }

  Future<void> deleteAccountData() async {
    if (_busy) return;
    final session = _authenticated();
    final epoch = ++_epoch; // Invalidate any pre-deletion GET/PUT completion.
    _busy = true;
    _notify();
    try {
      final revision = await _api.deleteState(session);
      if (!_current(epoch)) return;
      _data = _empty();
      _baseline = CloudSnapshot(data: null, revision: revision);
      _pending = false;
      _conflicts = [];
      _conflictCloud = null;
      _error = null;
      _notice = 'Account preferences and trips deleted.';
      await _persist(epoch);
      await _replan();
    } finally {
      if (_current(epoch)) {
        _busy = false;
        _notify();
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed && _initialized) {
      unawaited(refresh());
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _timer?.cancel();
    if (_initialized) WidgetsBinding.instance.removeObserver(this);
    _api.close();
    unawaited(engine.dispose());
    super.dispose();
  }
}
