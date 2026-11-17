/// Public assets and authenticated API requests use the same configured host.
Uri serviceOrigin([String? value]) {
  final origin = Uri.parse(
    value ??
        const String.fromEnvironment(
          'API_ORIGIN',
          defaultValue: 'https://rephase.surtani.org',
        ),
  );
  if (origin.scheme != 'https' &&
      !(origin.scheme == 'http' &&
          const {'localhost', '127.0.0.1', '10.0.2.2'}.contains(origin.host))) {
    throw ArgumentError(
      'API_ORIGIN must use HTTPS (local emulator development may use HTTP).',
    );
  }
  if (origin.host.isEmpty ||
      origin.userInfo.isNotEmpty ||
      origin.query.isNotEmpty ||
      origin.fragment.isNotEmpty ||
      (origin.path.isNotEmpty && origin.path != '/')) {
    throw ArgumentError('API_ORIGIN must be a plain origin.');
  }
  return origin;
}
