import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/engine/offline_planner_document.dart';

WebResourceRequest request({
  String url = OfflinePlannerDocument.url,
  bool? mainFrame = true,
  String? method = 'GET',
}) => WebResourceRequest(
  url: WebUri(url),
  isForMainFrame: mainFrame,
  method: method,
);

void main() {
  test('serves the UTF-8 planner document and keeps its script contained', () {
    final document = OfflinePlannerDocument(
      'globalThis.example = "Hawaiʻi </ScRiPt><script>unexpected()";',
    );
    final response = document.responseFor(request(), loading: true);

    expect(response.statusCode, 200);
    expect(response.contentType, 'text/html');
    expect(response.contentEncoding, 'utf-8');
    expect(response.headers, containsPair('Cache-Control', 'no-store'));
    final html = utf8.decode(response.data!);
    expect(html, document.html);
    expect(html, contains('Hawaiʻi'));
    expect(html, contains(r'<\/script><script>unexpected()'));
    expect(html, isNot(contains('</ScRiPt>')));
    expect(html, contains("default-src 'none'"));
    expect(html, contains("connect-src 'none'"));
    expect(html, contains("frame-src 'none'"));
    expect(html, contains("form-action 'none'"));
  });

  test(
    'rejects other origins, URLs and schemes without a response fallback',
    () {
      final document = OfflinePlannerDocument('globalThis.example = true;');
      for (final url in [
        'https://example.com/',
        'http://offline.rephase.invalid/',
        'https://offline.rephase.invalid.example.com/',
        'https://offline.rephase.invalid/planner.js',
        'https://offline.rephase.invalid/?reload=true',
        'https://offline.rephase.invalid/#fragment',
        'https://user@offline.rephase.invalid/',
        'https://offline.rephase.invalid:443/',
        'data:text/html,unexpected',
        'file:///android_asset/secret.txt',
        'about:blank',
      ]) {
        final response = document.responseFor(request(url: url), loading: true);
        expect(response.statusCode, 403, reason: url);
        expect(response.data, isEmpty, reason: url);
      }
    },
  );

  test(
    'rejects subresources and requests with missing main-frame metadata',
    () {
      final document = OfflinePlannerDocument('globalThis.example = true;');
      for (final mainFrame in [false, null]) {
        final response = document.responseFor(
          request(mainFrame: mainFrame),
          loading: true,
        );
        expect(response.statusCode, 403);
        expect(response.data, isEmpty);
      }
    },
  );

  test('rejects methods other than an explicit GET', () {
    final document = OfflinePlannerDocument('globalThis.example = true;');
    for (final method in ['POST', 'HEAD', 'get', '', null]) {
      final response = document.responseFor(
        request(method: method),
        loading: true,
      );
      expect(response.statusCode, 403, reason: '$method');
      expect(response.data, isEmpty);
    }
  });

  test('rejects even the planner document once startup has finished', () {
    final document = OfflinePlannerDocument('globalThis.example = true;');
    final response = document.responseFor(request(), loading: false);
    expect(response.statusCode, 403);
    expect(response.data, isEmpty);
  });
}
