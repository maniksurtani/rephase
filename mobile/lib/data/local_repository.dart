import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'models.dart';

abstract interface class LocalRepository {
  Future<CachedState?> read(String? accountId);
  Future<void> write(String? accountId, CachedState state);
  Future<void> clear(String? accountId);
}

/// One atomically replaced document per account. Writes are serialized so a
/// slower earlier save cannot replace a newer edit on disk.
class FileLocalRepository implements LocalRepository {
  FileLocalRepository({Future<Directory> Function()? directory})
    : _directory = directory ?? getApplicationSupportDirectory;
  final Future<Directory> Function() _directory;
  final Map<String, Future<void>> _writes = {};

  String _key(String? accountId) => accountId == null
      ? 'guest'
      : 'account-${base64Url.encode(utf8.encode(accountId)).replaceAll('=', '')}';

  Future<File> _file(String key) async {
    final root = Directory('${(await _directory()).path}/rephase');
    await root.create(recursive: true);
    return File('${root.path}/$key.json');
  }

  Future<void> _serialize(String key, Future<void> Function() operation) {
    final next = (_writes[key] ?? Future<void>.value())
        .catchError((Object _) {})
        .then((_) => operation());
    _writes[key] = next;
    // Keep a settled tail without propagating an unhandled secondary failure.
    next.then(
      (_) {
        if (identical(_writes[key], next)) _writes.remove(key);
      },
      onError: (Object _, StackTrace _) {
        if (identical(_writes[key], next)) _writes.remove(key);
      },
    );
    return next;
  }

  @override
  Future<CachedState?> read(String? accountId) async {
    final key = _key(accountId);
    await _writes[key];
    final file = await _file(key);
    if (!await file.exists()) return null;
    final value = jsonDecode(await file.readAsString());
    return CachedState.fromJson((value as Map).cast<String, dynamic>());
  }

  @override
  Future<void> write(String? accountId, CachedState state) {
    final content = jsonEncode(state.toJson()); // Capture before queuing.
    final key = _key(accountId);
    return _serialize(key, () async {
      final file = await _file(key);
      final temporary = File('${file.path}.tmp');
      await temporary.writeAsString(content, flush: true);
      await temporary.rename(file.path);
    });
  }

  @override
  Future<void> clear(String? accountId) {
    final key = _key(accountId);
    return _serialize(key, () async {
      final file = await _file(key);
      if (await file.exists()) await file.delete();
    });
  }
}
