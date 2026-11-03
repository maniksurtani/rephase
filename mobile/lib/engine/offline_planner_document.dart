import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Serves the bundled computation document without permitting network access.
class OfflinePlannerDocument {
  OfflinePlannerDocument(String script)
    : html = '''<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<script>${script.replaceAll(RegExp('</script', caseSensitive: false), r'<\/script')}</script></head><body></body></html>''';

  static const url = 'https://offline.rephase.invalid/';

  final String html;
  late final Uint8List _data = Uint8List.fromList(utf8.encode(html));
  static final Uint8List _empty = Uint8List(0);

  WebResourceResponse responseFor(
    WebResourceRequest request, {
    required bool loading,
  }) {
    final serveDocument =
        loading &&
        request.url.rawValue == url &&
        request.isForMainFrame == true &&
        request.method == 'GET';
    return WebResourceResponse(
      statusCode: serveDocument ? 200 : 403,
      reasonPhrase: serveDocument ? 'OK' : 'Offline computation only',
      contentType: serveDocument ? 'text/html' : 'text/plain',
      contentEncoding: 'utf-8',
      headers: const {'Cache-Control': 'no-store'},
      data: serveDocument ? _data : _empty,
    );
  }
}
