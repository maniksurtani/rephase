import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rephase/data/local_repository.dart';
import 'package:rephase/data/mobile_api.dart';
import 'package:rephase/data/models.dart';

AppData state(String label) => AppData.fromJson({
  'schemaVersion': 1,
  'preferences': {
    'homeTimeZone': 'Pacific/Honolulu',
    'futurePreference': {'label': label},
  },
  'trips': [],
  'selectedTripId': null,
  'futureRootField': [1, 2],
});

void main() {
  test(
    'schema wrappers retain unknown fields and protect nested snapshots',
    () {
      final original = state('kept');
      final edited = original.copy(
        preferences: original.preferences.withChanges({'caffeine': false}),
      );
      expect(edited.preferences.json['futurePreference'], {'label': 'kept'});
      expect(edited.json['futureRootField'], [1, 2]);
      final exported = edited.toJson();
      (exported['preferences'] as Map)['futurePreference'] = 'changed';
      expect(edited.preferences.json['futurePreference'], {'label': 'kept'});
      expect(
        () => (edited.preferences.json['futurePreference'] as Map)['label'] =
            'mutated',
        throwsUnsupportedError,
      );
      expect(edited.copy(selectedTripId: null).selectedTripId, isNull);
    },
  );

  test(
    'atomic saves serialize and keep guest and account namespaces separate',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'rephase-repository-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final repository = FileLocalRepository(directory: () async => directory);
      final first = repository.write(null, CachedState(data: state('first')));
      final latest = repository.write(null, CachedState(data: state('latest')));
      await Future.wait([
        first,
        latest,
        repository.write(
          'account/unsafe:id',
          CachedState(data: state('private'), pending: true),
        ),
      ]);
      expect(
        (await repository.read(
          null,
        ))!.data.preferences.json['futurePreference'],
        {'label': 'latest'},
      );
      expect((await repository.read('account/unsafe:id'))!.pending, isTrue);
      await repository.clear('account/unsafe:id');
      expect(await repository.read('account/unsafe:id'), isNull);
      expect(await repository.read(null), isNotNull);
      expect(
        (await directory.list(recursive: true).toList())
            .whereType<File>()
            .where((file) => file.path.endsWith('.tmp')),
        isEmpty,
      );
    },
  );

  test(
    'native requests bind bearer and expected account without browser cookies',
    () async {
      final session = AccountSession(
        account: Account.fromJson({
          'id': 'google-123',
          'name': 'A',
          'email': 'a@example.org',
        }),
        token: 'opaque-private-token',
        expiresAt: DateTime.utc(2027),
      );
      final api = HttpMobileApi(
        client: MockClient((request) async {
          expect(
            request.url.toString(),
            'https://rephase.surtani.org/api/flights?flightNumber=QF103&date=2026-10-17',
          );
          expect(
            request.headers['Authorization'],
            'Bearer opaque-private-token',
          );
          expect(request.headers['X-Rephase-Account'], 'google-123');
          expect(request.headers.containsKey('Cookie'), isFalse);
          expect(request.headers.containsKey('Origin'), isFalse);
          expect(request.followRedirects, isFalse);
          return http.Response('{"candidates":[]}', 200);
        }),
      );
      addTearDown(api.close);
      expect(
        (await api.lookupFlight(session, 'QF103', '2026-10-17'))['candidates'],
        isEmpty,
      );
      expect(
        () => HttpMobileApi(origin: 'http://example.org'),
        throwsArgumentError,
      );
    },
  );
}
