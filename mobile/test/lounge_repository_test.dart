import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rephase/data/lounge_repository.dart';
import 'package:rephase/data/models.dart';

// Full JSON Schema parity runs against the real engine in mobile-engine.test.ts.
Future<Json> validate(String operation, Json payload) async {
  if (operation == 'validateLoungeCatalog') {
    return {'catalog': payload['catalog']};
  }
  final data = payload['data'] as Map;
  if (data['schemaVersion'] != 1 || data['airport'] != payload['airport']) {
    throw const FormatException('Invalid guide');
  }
  return {'data': data};
}

void main() {
  late Directory directory;
  late DateTime now;
  late Map<String, String> files;
  late List<String> requests;
  late bool offline;
  const guide = {'schemaVersion': 1, 'airport': 'SFO', 'lounges': <Json>[]};
  String publish(Json data) {
    final raw = jsonEncode(data),
        version = sha256.convert(utf8.encode(raw)).toString();
    final path = '/lounge-data/v1/airports/SFO.$version.json';
    files[path] = raw;
    files['/lounge-data/v1/manifest.json'] = jsonEncode({
      'schemaVersion': 1,
      'airports': [
        {
          'airport': 'SFO',
          'timeZone': 'America/Los_Angeles',
          'updatedAt': '2026-11-18',
          'version': version,
          'path': path,
        },
      ],
    });
    return path;
  }

  LoungeRepository repository() => LoungeRepository(
    validate: validate,
    directory: () async => directory,
    clock: () => now,
    client: MockClient((request) async {
      requests.add(request.url.path);
      expect(request.headers.containsKey('authorization'), false);
      if (offline) throw const SocketException('offline');
      final body = files[request.url.path];
      return http.Response(
        body ?? '{}',
        body == null ? 404 : 200,
        headers: {'content-type': 'application/json'},
      );
    }),
  );
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('rephase-lounges-');
    now = DateTime.utc(2026, 11, 18);
    files = {};
    requests = [];
    offline = false;
    publish(guide);
  });
  tearDown(() async {
    await directory.delete(recursive: true);
  });
  test(
    'deduplicates downloads and reopens a valid guide offline after restart',
    () async {
      final first = repository();
      final results = await Future.wait([first.load('SFO'), first.load('SFO')]);
      expect(results.first.data, guide);
      expect(requests.length, 2);
      first.close();
      offline = true;
      now = now.add(const Duration(days: 2));
      final restarted = repository();
      final saved = await restarted.load('SFO');
      expect(saved.status, 'cached');
      expect(saved.data, guide);
      expect((await restarted.load('LAX')).status, 'unavailable');
      restarted.close();
    },
  );
  test(
    'refreshes published guides and preserves good data on corruption',
    () async {
      final repo = repository();
      await repo.load('SFO');
      final updated = {...guide, 'note': 'Updated guide'};
      publish(updated);
      now = now.add(const Duration(days: 2));
      expect((await repo.load('SFO')).data, updated);
      final path = publish({...updated, 'note': 'Damaged'});
      files[path] = jsonEncode({...updated, 'note': 'Wrong hash'});
      now = now.add(const Duration(days: 2));
      final fallback = await repo.load('SFO');
      expect(fallback.status, 'cached');
      expect(fallback.data, updated);
      repo.close();
      offline = true;
      final restarted = repository();
      expect((await restarted.load('SFO')).data, updated);
      restarted.close();
    },
  );
  test(
    'refreshes an old manifest whose hashed file was removed by deployment',
    () async {
      final repo = repository();
      await repo.refreshCatalog();
      files.clear();
      final next = {...guide, 'note': 'New deployment'};
      publish(next);
      expect((await repo.load('SFO')).data, next);
      expect(
        requests.where((path) => path.endsWith('manifest.json')).length,
        2,
      );
      repo.close();
    },
  );
  test(
    'prefetches only requested covered airports and reports missing coverage',
    () async {
      final repo = repository();
      await repo.prefetch(['SFO', 'SFO', 'LAX']);
      expect(requests.length, 2);
      expect((await repo.load('LAX')).status, 'unsupported');
      await repo.load('SFO');
      expect(requests.length, 2);
      repo.close();
    },
  );
  test('rejects incompatible content even when its hash matches', () async {
    final repo = repository();
    await repo.load('SFO');
    publish({...guide, 'schemaVersion': 2});
    now = now.add(const Duration(days: 2));
    expect((await repo.load('SFO')).data, guide);
    repo.close();
  });
}
