import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'mobile_engine.dart';

/// Computation only. Every visible screen is a native Flutter widget.
class BundledMobileEngine implements MobileEngine {
  HeadlessInAppWebView? _runtime;
  InAppWebViewController? _controller;
  Future<void>? _initializing;
  Future<void> _queue = Future.value();
  bool _disposed = false;

  Future<void> _initialize() {
    final pending = _initializing ??= _load();
    return pending.catchError((Object error, StackTrace stack) {
      _initializing = null;
      Error.throwWithStackTrace(error, stack);
    });
  }

  Future<void> _discardRuntime() async {
    final runtime = _runtime;
    _runtime = null;
    _controller = null;
    _initializing = null;
    try {
      await runtime?.dispose().timeout(const Duration(seconds: 5));
    } catch (_) {
      // A stopped renderer must not prevent a fresh runtime or app shutdown.
    }
  }

  Future<void> _load() async {
    final script = await rootBundle.loadString(
      'assets/engine/rephase-engine.js',
    );
    if (_disposed) {
      throw const MobileEngineException('The planner was closed.');
    }
    final ready = Completer<void>();
    final runtime = HeadlessInAppWebView(
      initialData: InAppWebViewInitialData(
        data: '''<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<script>${script.replaceAll(RegExp('</script', caseSensitive: false), r'<\/script')}</script></head><body></body></html>''',
        baseUrl: WebUri('https://offline.rephase.invalid/'),
      ),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        isInspectable: false,
        cacheEnabled: false,
        domStorageEnabled: false,
        databaseEnabled: false,
        allowFileAccess: false,
        allowContentAccess: false,
        allowFileAccessFromFileURLs: false,
        allowUniversalAccessFromFileURLs: false,
        javaScriptCanOpenWindowsAutomatically: false,
        supportMultipleWindows: false,
        useShouldOverrideUrlLoading: true,
        useShouldInterceptRequest: true,
      ),
      onWebViewCreated: (controller) => _controller = controller,
      shouldOverrideUrlLoading: (controller, navigation) async {
        final url = navigation.request.url?.toString();
        return !ready.isCompleted &&
                (url == 'about:blank' ||
                    url == 'https://offline.rephase.invalid/')
            ? NavigationActionPolicy.ALLOW
            : NavigationActionPolicy.CANCEL;
      },
      shouldInterceptRequest: (controller, request) async =>
          WebResourceResponse(
            statusCode: 403,
            reasonPhrase: 'Offline computation only',
            data: Uint8List(0),
          ),
      onLoadStop: (controller, url) {
        if (!ready.isCompleted) {
          ready.complete();
        }
      },
      onReceivedError: (controller, request, error) {
        if (!ready.isCompleted && request.isForMainFrame == true) {
          ready.completeError(
            MobileEngineException(
              'Could not start the offline planner: ${error.description}',
            ),
          );
        }
      },
    );
    _runtime = runtime;
    try {
      await runtime.run().timeout(const Duration(seconds: 20));
      await ready.future.timeout(const Duration(seconds: 20));
      final available = await _controller!
          .evaluateJavascript(
            source:
                'typeof RephaseMobile === "object" && typeof RephaseMobile.invoke === "function"',
          )
          .timeout(const Duration(seconds: 10));
      if (available != true) {
        throw const MobileEngineException(
          'The bundled planner could not be loaded.',
        );
      }
      final compatible = await _controller!
          .evaluateJavascript(
            source:
                'typeof structuredClone === "function" && typeof Object.hasOwn === "function" && typeof Array.prototype.at === "function" && typeof crypto.randomUUID === "function"',
          )
          .timeout(const Duration(seconds: 10));
      if (compatible != true) {
        throw const MobileEngineException(
          'Update your device’s system browser to run the offline planner.',
        );
      }
    } catch (_) {
      await _discardRuntime();
      rethrow;
    }
  }

  @override
  Future<Map<String, dynamic>> call(
    String operation, [
    Map<String, dynamic> payload = const {},
  ]) {
    final result = Completer<Map<String, dynamic>>();
    late final String source;
    try {
      source =
          'JSON.stringify(RephaseMobile.invoke(${jsonEncode(operation)},${jsonEncode(payload)}))';
    } catch (error, stack) {
      return Future.error(error, stack);
    }
    _queue = _queue.catchError((Object _) {}).then((_) async {
      var timedOut = false;
      try {
        if (_disposed) {
          throw const MobileEngineException('The planner was closed.');
        }
        await _initialize();
        if (_disposed) {
          throw const MobileEngineException('The planner was closed.');
        }
        final encoded = await _controller!
            .evaluateJavascript(source: source)
            .timeout(
              const Duration(seconds: 60),
              onTimeout: () {
                timedOut = true;
                throw const MobileEngineException(
                  'The offline planner took too long. Try again.',
                );
              },
            );
        if (encoded is! String) {
          throw const MobileEngineException(
            'The offline planner returned an invalid response.',
          );
        }
        final response = jsonDecode(encoded) as Map<String, dynamic>;
        if (response['ok'] != true) {
          throw MobileEngineException(
            response['error'] as String? ??
                'The offline planner could not finish.',
          );
        }
        result.complete(Map<String, dynamic>.from(response['result'] as Map));
      } catch (error, stack) {
        if (timedOut) {
          await _discardRuntime();
        }
        result.completeError(error, stack);
      }
    });
    return result.future;
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    await _queue;
    await _discardRuntime();
  }
}
