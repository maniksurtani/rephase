import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  const ApiException(this.message, this.status);
  final String message;
  final int status;
  @override
  String toString() => message;
}

abstract interface class MobileApi {
  Future<Json> config();
  Future<AccountSession> exchange(String credential);
  Future<Account> account(AccountSession session);
  Future<CloudSnapshot> getState(AccountSession session);
  Future<int> putState(AccountSession session, AppData data, int revision);
  Future<int> deleteState(AccountSession session);
  Future<void> logout(AccountSession session);
  Future<Json> lookupFlight(
    AccountSession session,
    String number,
    String date, {
    String? departureAirport,
  });
  void close();
}

class HttpMobileApi implements MobileApi {
  HttpMobileApi({String? origin, http.Client? client})
    : origin = Uri.parse(
        origin ??
            const String.fromEnvironment(
              'API_ORIGIN',
              defaultValue: 'https://rephase.surtani.org',
            ),
      ),
      _client = client ?? http.Client() {
    final host = this.origin.host;
    if (this.origin.scheme != 'https' &&
        !(this.origin.scheme == 'http' &&
            const {'localhost', '127.0.0.1', '10.0.2.2'}.contains(host))) {
      throw ArgumentError(
        'API_ORIGIN must use HTTPS (local emulator development may use HTTP).',
      );
    }
    if (this.origin.userInfo.isNotEmpty ||
        this.origin.query.isNotEmpty ||
        this.origin.fragment.isNotEmpty) {
      throw ArgumentError('API_ORIGIN must be a plain origin.');
    }
  }
  final Uri origin;
  final http.Client _client;

  Future<Json> _request(
    String path, {
    String method = 'GET',
    AccountSession? session,
    Json? body,
    Map<String, String>? query,
  }) async {
    final request = http.Request(
      method,
      origin.resolve(path).replace(queryParameters: query),
    )..followRedirects = false;
    request.headers['Accept'] = 'application/json';
    if (session != null) {
      request.headers['Authorization'] = 'Bearer ${session.token}';
      request.headers['X-Rephase-Account'] = session.account.id;
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 20));
    Json payload;
    try {
      payload = (jsonDecode(response.body) as Map).cast<String, dynamic>();
    } catch (_) {
      throw ApiException(
        'Account services are unavailable. Try again shortly.',
        response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        payload['error'] as String? ?? 'The request could not be completed.',
        response.statusCode,
      );
    }
    return payload;
  }

  @override
  Future<Json> config() => _request('/api/config');
  @override
  Future<AccountSession> exchange(String credential) async =>
      AccountSession.fromJson(
        await _request(
          '/api/mobile/auth/google',
          method: 'POST',
          body: {'credential': credential},
        ),
      );
  @override
  Future<Account> account(AccountSession session) async =>
      Account.fromJson(await _request('/api/me', session: session));
  @override
  Future<CloudSnapshot> getState(AccountSession session) async =>
      CloudSnapshot.fromJson(await _request('/api/state', session: session));
  @override
  Future<int> putState(
    AccountSession session,
    AppData data,
    int revision,
  ) async =>
      (await _request(
            '/api/state',
            method: 'PUT',
            session: session,
            body: {'data': data.toJson(), 'revision': revision},
          ))['revision']
          as int;
  @override
  Future<int> deleteState(AccountSession session) async =>
      (await _request(
            '/api/state',
            method: 'DELETE',
            session: session,
          ))['revision']
          as int;
  @override
  Future<void> logout(AccountSession session) async {
    await _request('/api/mobile/auth/logout', method: 'POST', session: session);
  }

  @override
  Future<Json> lookupFlight(
    AccountSession session,
    String number,
    String date, {
    String? departureAirport,
  }) => _request(
    '/api/flights',
    session: session,
    query: {
      'flightNumber': number,
      'date': date,
      if (departureAirport != null && departureAirport.isNotEmpty)
        'departureAirport': departureAirport,
    },
  );
  @override
  void close() => _client.close();
}
