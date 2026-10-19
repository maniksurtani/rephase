import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:url_launcher/url_launcher.dart';

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
  GoogleSignInIdentity({Future<bool> Function(Uri)? canLaunchCallback})
    : _canLaunchCallback = canLaunchCallback ?? canLaunchUrl;

  final Future<bool> Function(Uri) _canLaunchCallback;
  Future<void>? _initialized;
  static final _clientIdPattern = RegExp(
    r'^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$',
  );

  Future<void> _checkConfiguration(
    String serverClientId,
    String? clientId,
  ) async {
    const unavailable = 'Google sign-in is not available in this build.';
    if (!_clientIdPattern.hasMatch(serverClientId) ||
        (clientId != null && !_clientIdPattern.hasMatch(clientId))) {
      throw StateError(unavailable);
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      if (clientId == null) throw StateError(unavailable);
      // The current iOS Google SDK throws native exceptions for configuration
      // errors. Verify the app's registered callback before entering the SDK.
      final scheme = clientId.split('.').reversed.join('.');
      bool registered;
      try {
        registered = await _canLaunchCallback(Uri(scheme: scheme));
      } catch (_) {
        throw StateError(unavailable);
      }
      if (!registered) throw StateError(unavailable);
    }
  }

  @override
  Future<String?> authenticate({
    required String serverClientId,
    String? clientId,
  }) async {
    await _checkConfiguration(serverClientId, clientId);
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
