import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'models.dart';
import 'service_origin.dart';

class LoungeGuide {
  const LoungeGuide(this.status, [this.data]);
  final String status;
  final Json? data;
}

/// Public content, deliberately separate from account state and credentials.
/// The shared engine validates schema/access rules; Dart handles network/disk IO.
class LoungeRepository {
  LoungeRepository({
    required this.validate,
    http.Client? client,
    Future<Directory> Function()? directory,
    DateTime Function()? clock,
    String? origin,
  }) : _client = client ?? http.Client(),
       _directory = directory ?? _defaultDirectory,
       _clock = clock ?? DateTime.now,
       _origin = serviceOrigin(origin);

  final Future<Json> Function(String operation, Json payload) validate;
  final http.Client _client;
  final Future<Directory> Function() _directory;
  final DateTime Function() _clock;
  final Uri _origin;
  static const _ttl = Duration(days: 1);
  static Future<Directory> _defaultDirectory() async => Directory(
    '${(await getApplicationSupportDirectory()).path}/rephase/lounge-guides',
  );
  Json catalog = {'schemaVersion': 1, 'airports': <Json>[]};
  final _memory = <String, Json>{};
  final _requests = <String, Future<LoungeGuide>>{};
  Set<String> _pinned = {};
  DateTime? _checkedAt;
  DateTime? _attemptedAt;
  bool _hydrated = false;
  bool _closed = false;
  Future<void>? _catalogRequest;
  Future<void>? _prefetching;
  String _prefetchKey = '';
  bool get _fresh =>
      _checkedAt != null && _clock().difference(_checkedAt!) < _ttl;

  Future<Json?> _read(String key) async {
    try {
      final file = File('${(await _directory()).path}/$key.json');
      if (await file.length() > 3 * 1024 * 1024) return null;
      return (jsonDecode(await file.readAsString()) as Map)
          .cast<String, dynamic>();
    } catch (_) {
      return null;
    }
  }

  Future<void> _save(String key, Json value) async {
    try {
      final dir = await _directory();
      await dir.create(recursive: true);
      final file = File('${dir.path}/$key.json.tmp');
      await file.writeAsString(jsonEncode(value), flush: true);
      await file.rename('${dir.path}/$key.json');
    } catch (_) {
      /* Keep the memory copy if storage is unavailable/full. */
    }
  }

  Future<String> _download(String path, int limit) async {
    if (_closed) throw StateError('Closed');
    final abort = Completer<void>();
    final timer = Timer(const Duration(seconds: 8), () => abort.complete());
    final request = http.AbortableRequest(
      'GET',
      _origin.resolve(path),
      abortTrigger: abort.future,
    )..followRedirects = false;
    request.headers['Accept'] = 'application/json';
    try {
      return await (() async {
        final response = await _client.send(request);
        if (response.statusCode != 200 ||
            !(response.headers['content-type'] ?? '').contains(
              'application/json',
            ) ||
            (response.contentLength ?? 0) > limit) {
          await response.stream.listen(null).cancel();
          throw const FormatException('Guide unavailable');
        }
        final bytes = <int>[];
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > limit) {
            throw const FormatException('Guide too large');
          }
          bytes.addAll(chunk);
        }
        return utf8.decode(bytes);
      })().timeout(const Duration(seconds: 8));
    } finally {
      timer.cancel();
    }
  }

  Future<void> refreshCatalog({bool force = false}) async {
    if (_catalogRequest != null) return _catalogRequest;
    _catalogRequest = _refreshCatalog(force);
    try {
      await _catalogRequest;
    } finally {
      _catalogRequest = null;
    }
  }

  Future<void> _refreshCatalog(bool force) async {
    if (!_hydrated) {
      final saved = await _read('catalog');
      try {
        if (saved != null) {
          final parsed = await validate('validateLoungeCatalog', {
            'catalog': saved['catalog'],
          });
          catalog = (parsed['catalog'] as Map).cast<String, dynamic>();
          _checkedAt = DateTime.tryParse('${saved['checkedAt']}');
        }
      } catch (_) {
        /* Ignore incompatible/corrupt caches. */
      }
      _hydrated = true;
    }
    final now = _clock();
    if (!force &&
        (_fresh ||
            (_attemptedAt != null &&
                now.difference(_attemptedAt!) < const Duration(minutes: 1)))) {
      return;
    }
    _attemptedAt = now;
    try {
      final raw = await _download(
        '/lounge-data/v1/manifest.json',
        2 * 1024 * 1024,
      );
      final parsed = await validate('validateLoungeCatalog', {
        'catalog': jsonDecode(raw),
      });
      catalog = (parsed['catalog'] as Map).cast<String, dynamic>();
      _checkedAt = now;
      await _save('catalog', {
        'catalog': catalog,
        'checkedAt': now.toIso8601String(),
      });
    } catch (_) {
      /* Keep the last index or bundled seed when offline. */
    }
  }

  Json? _entry(String airport) => jsonObjects(
    catalog['airports'],
  ).where((e) => e['airport'] == airport).firstOrNull;

  Future<LoungeGuide> load(String airport) async {
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(airport)) {
      return const LoungeGuide('unsupported');
    }
    if (_requests[airport] != null) return _requests[airport]!;
    final request = _load(airport);
    _requests[airport] = request;
    try {
      return await request;
    } finally {
      _requests.remove(airport);
    }
  }

  Future<LoungeGuide> _load(String airport) async {
    Json? cached = _memory[airport];
    if (cached == null) {
      try {
        final saved = await _read(airport);
        if (saved != null &&
            RegExp(r'^[a-f0-9]{64}$').hasMatch('${saved['version']}')) {
          final parsed = await validate('validateLoungeGuide', {
            'airport': airport,
            'data': saved['data'],
          });
          cached = {...saved, 'data': parsed['data']};
        }
      } catch (_) {
        /* Bad local data cannot replace a validated download. */
      }
    }
    await refreshCatalog();
    var entry = _entry(airport);
    if (entry == null) {
      return LoungeGuide(_fresh ? 'unsupported' : 'unavailable');
    }
    try {
      var changed = cached == null || cached['version'] != entry['version'];
      if (changed) {
        String raw;
        try {
          raw = await _download(entry['path'] as String, 1024 * 1024);
        } catch (_) {
          final previous = entry['version'];
          await refreshCatalog(force: true);
          entry = _entry(airport);
          if (entry == null || entry['version'] == previous) rethrow;
          raw = await _download(entry['path'] as String, 1024 * 1024);
        }
        final version = sha256.convert(utf8.encode(raw)).toString();
        if (version != entry['version']) {
          throw const FormatException('Guide version mismatch');
        }
        final parsed = await validate('validateLoungeGuide', {
          'airport': airport,
          'data': jsonDecode(raw),
        });
        cached = {'version': version, 'data': parsed['data']};
      }
      changed =
          changed ||
          _clock().millisecondsSinceEpoch -
                  ((cached['usedAt'] as num?)?.toInt() ?? 0) >
              3600000;
      _memory[airport] = cached;
      if (changed) {
        cached['usedAt'] = _clock().millisecondsSinceEpoch;
        await _save(airport, cached);
        await _trim();
      }
      return LoungeGuide(
        _fresh ? 'ready' : 'cached',
        (cached['data'] as Map).cast<String, dynamic>(),
      );
    } catch (_) {
      if (cached != null) {
        _memory[airport] = cached;
        return LoungeGuide(
          'cached',
          (cached['data'] as Map).cast<String, dynamic>(),
        );
      }
      return const LoungeGuide('unavailable');
    }
  }

  Future<void> prefetch(List<String> airports) async {
    _pinned = airports.toSet();
    final key = (airports.toSet().toList()..sort()).join(',');
    if (_prefetching != null) {
      if (key == _prefetchKey) return _prefetching;
      await _prefetching;
      return prefetch(_pinned.toList());
    }
    _prefetchKey = key;
    _prefetching = (() async {
      await refreshCatalog();
      final queue = _pinned.where((code) => _entry(code) != null).toList();
      Future<void> run() async {
        while (queue.isNotEmpty && !_closed) {
          await load(queue.removeLast());
        }
      }

      await Future.wait([run(), run()]);
      await _trim();
    })();
    try {
      await _prefetching;
    } finally {
      _prefetching = null;
    }
  }

  Future<void> _trim() async {
    try {
      final dir = await _directory();
      final codes = <String>[];
      await for (final file in dir.list()) {
        final code = file.uri.pathSegments.last.split('.').first;
        if (file.path.endsWith('.json') &&
            RegExp(r'^[A-Z]{3}$').hasMatch(code) &&
            !_pinned.contains(code) &&
            !_requests.containsKey(code)) {
          codes.add(code);
        }
      }
      if (codes.length <= 64) return;
      final entries = <({String code, int used})>[];
      for (final code in codes) {
        final cached = await _read(code);
        entries.add((
          code: code,
          used: (cached?['usedAt'] as num?)?.toInt() ?? 0,
        ));
      }
      entries.sort((a, b) => b.used.compareTo(a.used));
      for (final entry in entries.skip(64)) {
        await File('${dir.path}/${entry.code}.json').delete();
        _memory.remove(entry.code);
      }
    } catch (_) {
      /* Cleanup must not block a guide. */
    }
  }

  void close() {
    _closed = true;
    _client.close();
  }
}
