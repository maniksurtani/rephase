abstract interface class MobileEngine {
  Future<Map<String, dynamic>> call(
    String operation, [
    Map<String, dynamic> payload = const {},
  ]);

  Future<void> dispose();
}

class MobileEngineException implements Exception {
  const MobileEngineException(this.message);
  final String message;
  @override
  String toString() => message;
}
