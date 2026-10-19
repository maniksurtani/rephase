import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'mobile_engine.dart';

/// Computation only. Every visible screen is a native Flutter widget.
class BundledMobileEngine implements MobileEngine {
  static const _processLost = MobileEngineException(
    'The offline planner stopped. Try again.',
  );
  static const _invalidResponse = MobileEngineException(
    'The offline planner returned an invalid response.',
  );
  HeadlessInAppWebView? _runtime;
  InAppWebViewController? _controller;
  StreamController<void>? _runtimeLost;
  Future<void>? _initializing;
  Future<void> _queue = Future.value();
  bool _disposed = false;

  Future<T> _whileAlive<T>(
    Future<T> operation,
    StreamController<void> lost,
  ) async {
    final interrupted = Completer<T>();
    void stopped() {
      if (!interrupted.isCompleted) {
        interrupted.completeError(_processLost);
      }
    }

    final subscription = lost.stream.listen((_) => stopped(), onDone: stopped);
    try {
      return await Future.any<T>([operation, interrupted.future]);
    } finally {
      await subscription.cancel();
    }
  }

  Future<void> _initialize() {
    final pending = _initializing ??= _load();
    return pending.catchError((Object error, StackTrace stack) {
      if (identical(_initializing, pending)) {
        _initializing = null;
      }
      Error.throwWithStackTrace(error, stack);
    });
  }

  Future<void> _discardRuntime([HeadlessInAppWebView? expected]) async {
    if (expected != null && !identical(_runtime, expected)) {
      return;
    }
    final runtime = _runtime;
    final lost = _runtimeLost;
    _runtime = null;
    _controller = null;
    _initializing = null;
    _runtimeLost = null;
    if (lost != null && !lost.isClosed) {
      lost.add(null);
      unawaited(lost.close());
    }
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
    final lost = StreamController<void>.broadcast();
    MobileEngineException? loadError;
    late final HeadlessInAppWebView runtime;
    void invalidateRuntime() {
      if (!identical(_runtime, runtime)) {
        return;
      }
      if (!ready.isCompleted) {
        loadError = _processLost;
        ready.complete();
      }
      unawaited(_discardRuntime(runtime));
    }

    runtime = HeadlessInAppWebView(
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
      onWebViewCreated: (controller) {
        if (identical(_runtime, runtime)) {
          _controller = controller;
        }
      },
      onWebContentProcessDidTerminate: (_) => invalidateRuntime(),
      onRenderProcessGone: (_, _) => invalidateRuntime(),
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
          loadError = MobileEngineException(
            'Could not start the offline planner: ${error.description}',
          );
          ready.complete();
        }
      },
    );
    _runtime = runtime;
    _runtimeLost = lost;
    try {
      await _whileAlive<void>(
        Future.wait<void>([
          ready.future,
          runtime.run(),
        ], eagerError: true).then<void>((_) {}),
        lost,
      ).timeout(const Duration(seconds: 20));
      if (loadError != null) {
        throw loadError!;
      }
      final available = await _whileAlive<dynamic>(
        _controller!.evaluateJavascript(
          source:
              'typeof RephaseMobile === "object" && typeof RephaseMobile.invoke === "function"',
        ),
        lost,
      ).timeout(const Duration(seconds: 10));
      if (available != true) {
        throw const MobileEngineException(
          'The bundled planner could not be loaded.',
        );
      }
      final compatible = await _whileAlive<dynamic>(
        _controller!.evaluateJavascript(
          source:
              'typeof structuredClone === "function" && typeof Object.hasOwn === "function" && typeof Array.prototype.at === "function" && typeof crypto.randomUUID === "function"',
        ),
        lost,
      ).timeout(const Duration(seconds: 10));
      if (compatible != true) {
        throw const MobileEngineException(
          'Update your device’s system browser to run the offline planner.',
        );
      }
    } catch (_) {
      await _discardRuntime(runtime);
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
      HeadlessInAppWebView? activeRuntime;
      var transportFailed = false;
      try {
        if (_disposed) {
          throw const MobileEngineException('The planner was closed.');
        }
        await _initialize();
        if (_disposed) {
          throw const MobileEngineException('The planner was closed.');
        }
        activeRuntime = _runtime;
        final controller = _controller;
        final lost = _runtimeLost;
        if (activeRuntime == null || controller == null || lost == null) {
          throw _processLost;
        }
        transportFailed = true;
        final encoded =
            await _whileAlive<dynamic>(
              controller.evaluateJavascript(source: source),
              lost,
            ).timeout(
              const Duration(seconds: 60),
              onTimeout: () {
                throw const MobileEngineException(
                  'The offline planner took too long. Try again.',
                );
              },
            );
        if (encoded is! String) {
          throw _invalidResponse;
        }
        Object? response;
        try {
          response = jsonDecode(encoded);
        } on FormatException {
          throw _invalidResponse;
        }
        if (response is! Map<String, dynamic> ||
            (response['ok'] != true &&
                !(response['ok'] == false && response['error'] is String)) ||
            (response['ok'] == true && response['result'] is! Map)) {
          throw _invalidResponse;
        }
        transportFailed = false;
        if (response['ok'] == false) {
          throw MobileEngineException(response['error'] as String);
        }
        result.complete(Map<String, dynamic>.from(response['result'] as Map));
      } catch (error, stack) {
        if (transportFailed && activeRuntime != null) {
          await _discardRuntime(activeRuntime);
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
