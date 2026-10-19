import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/data/session_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'iOS guest or mismatched callback builds fail before entering the native SDK',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final checkedCallbacks = <Uri>[];
      final identity = GoogleSignInIdentity(
        canLaunchCallback: (uri) async {
          checkedCallbacks.add(uri);
          return false;
        },
      );
      final unavailable = isA<StateError>().having(
        (error) => error.message,
        'message',
        'Google sign-in is not available in this build.',
      );
      const serverId = '123-web.apps.googleusercontent.com';

      // There is deliberately no Google platform plugin stub: reaching the SDK
      // would fail this test with MissingPluginException instead of StateError.
      await expectLater(
        identity.authenticate(serverClientId: serverId),
        throwsA(unavailable),
      );
      await expectLater(
        identity.authenticate(
          serverClientId: 'invalid',
          clientId: '123-ios.apps.googleusercontent.com',
        ),
        throwsA(unavailable),
      );
      expect(checkedCallbacks, isEmpty);
      await expectLater(
        identity.authenticate(
          serverClientId: serverId,
          clientId: '123-ios.apps.googleusercontent.com',
        ),
        throwsA(unavailable),
      );
      expect(
        checkedCallbacks.single.scheme,
        'com.googleusercontent.apps.123-ios',
      );
      await identity.signOut();
    },
  );
}
