import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'models.dart';

abstract interface class SessionStore {
  Future<AccountSession?> read();
  Future<void> write(AccountSession? session);
}

/// Bearer credentials live in platform Keychain/Keystore, never in app JSON.
class SecureSessionStore implements SessionStore {
  SecureSessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'rephase.mobile.session.v1';
  Future<void> _tail = Future<void>.value();

  @override
  Future<AccountSession?> read() async {
    await _tail;
    final value = await _storage.read(key: _key);
    return value == null
        ? null
        : AccountSession.fromJson(
            (jsonDecode(value) as Map).cast<String, dynamic>(),
          );
  }

  @override
  Future<void> write(AccountSession? session) {
    final value = session == null ? null : jsonEncode(session.toJson());
    final next = _tail
        .catchError((Object _) {})
        .then(
          (_) => value == null
              ? _storage.delete(key: _key)
              : _storage.write(key: _key, value: value),
        );
    _tail = next;
    return next;
  }
}

abstract interface class GoogleIdentity {
  Future<String?> authenticate({
    required String serverClientId,
    String? clientId,
  });
  Future<void> signOut();
}

class GoogleSignInIdentity implements GoogleIdentity {
  Future<void>? _initialized;

  @override
  Future<String?> authenticate({
    required String serverClientId,
    String? clientId,
  }) async {
    _initialized ??= GoogleSignIn.instance.initialize(
      serverClientId: serverClientId,
      clientId: clientId,
    );
    await _initialized;
    try {
      final account = await GoogleSignIn.instance.authenticate();
      return account.authentication.idToken;
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      rethrow;
    }
  }

  @override
  Future<void> signOut() async {
    if (_initialized != null) {
      await _initialized;
      await GoogleSignIn.instance.signOut();
    }
  }
}
