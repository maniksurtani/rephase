import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/app_controller.dart';
import 'package:rephase/data/local_repository.dart';
import 'package:rephase/data/mobile_api.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/data/session_store.dart';
import 'package:rephase/engine/mobile_engine.dart';

final defaults = <String, dynamic>{
  'homeTimeZone': 'Pacific/Honolulu',
  'caffeine': true,
};
AppData state({bool caffeine = true, String? tripName}) => AppData.fromJson({
  'schemaVersion': 1,
  'preferences': {...defaults, 'caffeine': caffeine},
  'trips': tripName == null
      ? []
      : [
          {
            'id': 'trip-1',
            'name': tripName,
            'createdAt': '2026-10-01T00:00:00Z',
            'updatedAt': '2026-10-01T00:00:00Z',
            'legs': [],
          },
        ],
  'selectedTripId': tripName == null ? null : 'trip-1',
});
final account = Account.fromJson({
  'id': 'account-1',
  'name': 'Traveler',
  'email': 'test@example.org',
});
AccountSession session({bool expired = false}) => AccountSession(
  account: account,
  token: 'secret',
  expiresAt: expired ? DateTime.utc(2020) : DateTime.utc(2030),
);

class MemoryRepository implements LocalRepository {
  final values = <String?, CachedState>{};
  @override
  Future<CachedState?> read(String? accountId) async => values[accountId];
  @override
  Future<void> write(String? accountId, CachedState state) async {
    values[accountId] = state;
  }

  @override
  Future<void> clear(String? accountId) async {
    values.remove(accountId);
  }
}

class MemorySession implements SessionStore {
  MemorySession(this.value);
  AccountSession? value;
  bool failWrite = false;
  Completer<AccountSession?>? delayedRead;
  @override
  Future<AccountSession?> read() async =>
      delayedRead == null ? value : delayedRead!.future;
  @override
  Future<void> write(AccountSession? session) async {
    if (failWrite) throw StateError('Platform secure storage unavailable');
    value = session;
  }
}

class Identity implements GoogleIdentity {
  @override
  Future<String?> authenticate({
    required String serverClientId,
    String? clientId,
  }) async => 'google-credential';
  @override
  Future<void> signOut() async {}
}

class Engine implements MobileEngine {
  final operations = <String>[];
  Completer<Json>? validation;
  @override
  Future<Json> call(String operation, [Json payload = const {}]) async {
    operations.add(operation);
    switch (operation) {
      case 'bootstrap':
        return {
          'defaultPreferences': defaults,
          'demoTrip': state(tripName: 'Example').trips.single.toJson(),
        };
      case 'validateData':
        return validation == null ||
                (payload['data'] as Map)['preferences']['caffeine'] != false
            ? {'valid': true}
            : validation!.future;
      case 'validateTrip':
        return {'valid': true, 'errors': []};
      case 'plan':
      case 'view':
        return {
          'plan': payload['plan'] ?? {'id': 'generated'},
          'days': [],
          'today': {},
        };
      case 'merge':
        final base = AppData.fromJson(payload['base'] as Json);
        final local = AppData.fromJson(payload['local'] as Json);
        final remote = AppData.fromJson(payload['remote'] as Json);
        // The real engine's merger has its own exhaustive TS tests. This fake
        // covers orchestration with independent preference/trip edits.
        return {
          'data': remote
              .copy(
                preferences: local.preferences,
                trips: local.trips.isEmpty && base.trips.isNotEmpty
                    ? []
                    : remote.trips,
              )
              .toJson(),
          'conflicts': [],
        };
      default:
        throw StateError('Unexpected operation $operation');
    }
  }

  @override
  Future<void> dispose() async {}
}

class Api implements MobileApi {
  CloudSnapshot cloud = CloudSnapshot(data: state(), revision: 1);
  bool offline = false;
  bool conflictOnce = false;
  int writes = 0;
  int calls = 0;
  Completer<CloudSnapshot>? blockedRead;
  Completer<int>? blockedWrite;
  void online() {
    calls++;
    if (offline) throw const ApiException('Offline', 503);
  }

  @override
  Future<Json> config() async => {'googleClientId': 'web-client'};
  @override
  Future<AccountSession> exchange(String credential) async => session();
  @override
  Future<Account> account(AccountSession session) async {
    online();
    return session.account;
  }

  @override
  Future<CloudSnapshot> getState(AccountSession session) async {
    online();
    return blockedRead == null ? cloud : blockedRead!.future;
  }

  @override
  Future<int> putState(
    AccountSession session,
    AppData data,
    int revision,
  ) async {
    online();
    writes++;
    if (blockedWrite != null) {
      final revision = await blockedWrite!.future;
      cloud = CloudSnapshot(data: data, revision: revision);
      return revision;
    }
    if (conflictOnce) {
      conflictOnce = false;
      cloud = CloudSnapshot(
        data: state(tripName: 'Added on web'),
        revision: cloud.revision + 1,
      );
      throw const ApiException('Conflict', 409);
    }
    if (revision != cloud.revision) throw const ApiException('Conflict', 409);
    cloud = CloudSnapshot(data: data, revision: revision + 1);
    return cloud.revision;
  }

  @override
  Future<int> deleteState(AccountSession session) async {
    cloud = CloudSnapshot(data: null, revision: cloud.revision + 1);
    return cloud.revision;
  }

  @override
  Future<void> logout(AccountSession session) async {}
  @override
  Future<Json> lookupFlight(
    AccountSession session,
    String number,
    String date, {
    String? departureAirport,
  }) async => {'candidates': []};
  @override
  void close() {}
}

Future<void> settle() async {
  for (var i = 0; i < 12; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  AppController create({
    required MemoryRepository repository,
    required Api api,
    MemorySession? sessions,
    Engine? engine,
  }) => AppController(
    engine: engine ?? Engine(),
    repository: repository,
    api: api,
    sessionStore: sessions ?? MemorySession(session()),
    identity: Identity(),
    clock: () => DateTime.utc(2026, 10, 18),
  );

  test(
    'sign-in loads account cloud state without copying guest trips',
    () async {
      final repository = MemoryRepository()
        ..values[null] = CachedState(
          data: state(tripName: 'Private guest trip'),
        );
      final api = Api();
      final controller = create(
        repository: repository,
        api: api,
        sessions: MemorySession(null),
      );
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.trips.single.name, 'Private guest trip');
      await controller.signIn();
      expect(controller.signedIn, isTrue);
      expect(controller.trips, isEmpty);
      expect(api.writes, 0);
      await controller.signOut();
      expect(controller.trips.single.name, 'Private guest trip');
    },
  );

  test(
    'offline edits survive restart and CAS retry merges another device trip',
    () async {
      final baseline = CloudSnapshot(data: state(), revision: 1);
      final repository = MemoryRepository()
        ..values[account.id] = CachedState(data: state(), baseline: baseline);
      final api = Api()..offline = true;
      final first = create(repository: repository, api: api);
      await first.initialize();
      await first.savePreferences(
        first.preferences!.withChanges({'caffeine': false}),
      );
      await settle();
      expect(repository.values[account.id]!.pending, isTrue);
      first.dispose();
      api.offline = false;
      api.conflictOnce = true;
      final resumed = create(repository: repository, api: api);
      addTearDown(resumed.dispose);
      await resumed.initialize();
      expect(resumed.preferences!.caffeine, isFalse);
      expect(resumed.trips.single.name, 'Added on web');
      expect(api.writes, 2);
      expect(repository.values[account.id]!.pending, isFalse);
    },
  );

  test(
    'cloud deletion never silently recreates data from offline edits',
    () async {
      final repository = MemoryRepository()
        ..values[account.id] = CachedState(
          data: state(caffeine: false),
          baseline: CloudSnapshot(data: state(), revision: 1),
          pending: true,
        );
      final api = Api()..cloud = const CloudSnapshot(data: null, revision: 2);
      final controller = create(repository: repository, api: api);
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.preferences!.caffeine, isFalse);
      expect(controller.conflicts, isNotEmpty);
      expect(api.writes, 0);
      await controller.resolveConflict(useLocal: false);
      expect(controller.preferences!.caffeine, isTrue);
      expect(controller.pendingSave, isFalse);
      expect(api.writes, 0);
    },
  );

  test(
    'edits made during a PUT survive its late response and save again',
    () async {
      final repository = MemoryRepository()
        ..values[account.id] = CachedState(
          data: state(),
          baseline: CloudSnapshot(data: state(), revision: 1),
        );
      final api = Api();
      final controller = create(repository: repository, api: api);
      addTearDown(controller.dispose);
      await controller.initialize();
      final upload = Completer<int>();
      api.blockedWrite = upload;
      await controller.savePreferences(
        controller.preferences!.withChanges({'caffeine': false}),
      );
      await settle();
      expect(api.writes, 1);
      await controller.savePreferences(
        controller.preferences!.withChanges({'homeTimeZone': 'Asia/Tokyo'}),
      );
      api.blockedWrite = null;
      upload.complete(2);
      await settle();
      expect(controller.preferences!.caffeine, isFalse);
      expect(controller.preferences!.homeTimeZone, 'Asia/Tokyo');
      expect(api.cloud.data!.preferences.homeTimeZone, 'Asia/Tokyo');
      expect(repository.values[account.id]!.pending, isFalse);
      expect(api.writes, 2);
    },
  );

  test(
    'logout discards late account responses and invalidates pending validation',
    () async {
      final repository = MemoryRepository()
        ..values[null] = CachedState(data: state(tripName: 'Guest'));
      final api = Api();
      final engine = Engine();
      final controller = create(
        repository: repository,
        api: api,
        engine: engine,
      );
      addTearDown(controller.dispose);
      await controller.initialize();
      api.blockedRead = Completer<CloudSnapshot>();
      final refresh = controller.refresh();
      await settle();
      engine.validation = Completer<Json>();
      final edit = controller.savePreferences(
        controller.preferences!.withChanges({'caffeine': false}),
      );
      await controller.signOut();
      engine.validation!.complete({'valid': true});
      api.blockedRead!.complete(
        CloudSnapshot(data: state(tripName: 'Account secret'), revision: 4),
      );
      await Future.wait([refresh, edit]);
      expect(controller.signedIn, isFalse);
      expect(controller.trips.single.name, 'Guest');
      expect(controller.preferences!.caffeine, isTrue);
    },
  );

  test(
    'expired native token allows offline planning but makes no account requests',
    () async {
      final repository = MemoryRepository()
        ..values[account.id] = CachedState(
          data: state(tripName: 'Saved journey'),
          baseline: CloudSnapshot(data: state(), revision: 1),
        );
      final api = Api();
      final controller = create(
        repository: repository,
        api: api,
        sessions: MemorySession(session(expired: true)),
      );
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.needsSignIn, isTrue);
      expect(controller.trips.single.name, 'Saved journey');
      expect(api.calls, 0);
      expect(controller.notice, contains('Sign in again'));
    },
  );

  test(
    'logout during startup cannot restore a late secure-session read',
    () async {
      final repository = MemoryRepository()
        ..values[null] = CachedState(data: state());
      final sessions = MemorySession(session())
        ..delayedRead = Completer<AccountSession?>();
      final api = Api();
      final controller = create(
        repository: repository,
        api: api,
        sessions: sessions,
      );
      addTearDown(controller.dispose);
      final initialization = controller.initialize();
      await settle();
      await controller.signOut();
      sessions.delayedRead!.complete(session());
      await initialization;
      expect(controller.signedIn, isFalse);
      expect(controller.data, isNotNull);
      expect(api.calls, 0);
    },
  );

  test(
    'failed credential removal still restores guest UI and supports retry',
    () async {
      final repository = MemoryRepository()
        ..values[null] = CachedState(data: state());
      final sessions = MemorySession(session());
      final controller = create(
        repository: repository,
        api: Api(),
        sessions: sessions,
      );
      addTearDown(controller.dispose);
      await controller.initialize();
      sessions.failWrite = true;
      await controller.signOut();
      expect(controller.signedIn, isFalse);
      expect(controller.data, isNotNull);
      expect(controller.busy, isFalse);
      expect(controller.signOutNeedsRetry, isTrue);
      expect(controller.error, contains('could not remove its saved sign-in'));
      sessions.failWrite = false;
      await controller.signOut();
      expect(controller.signOutNeedsRetry, isFalse);
      expect(controller.data, isNotNull);
      expect(sessions.value, isNull);
    },
  );

  test(
    'lounge preference and clock refresh reuse the calculated scientific plan',
    () async {
      final engine = Engine();
      final repository = MemoryRepository()
        ..values[null] = CachedState(data: state(tripName: 'Journey'));
      final controller = create(
        repository: repository,
        api: Api(),
        sessions: MemorySession(null),
        engine: engine,
      );
      addTearDown(controller.dispose);
      await controller.initialize();
      await controller.savePreferences(
        controller.preferences!.withChanges({'loungePriority': 'showers'}),
      );
      await controller.refresh();
      expect(
        engine.operations.where((operation) => operation == 'plan').length,
        1,
      );
      expect(
        engine.operations.where((operation) => operation == 'view').length,
        2,
      );
    },
  );
}
