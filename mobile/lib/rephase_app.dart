import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'app_controller.dart';
import 'features/lounges/lounges_screen.dart';
import 'features/plan/plan_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/today/today_screen.dart';
import 'features/trips/trip_editor_screen.dart';
import 'features/trips/trips_screen.dart';
import 'ui/common.dart';
import 'ui/theme.dart';

class RephaseApp extends StatefulWidget {
  const RephaseApp({super.key, required this.controller});
  final AppController controller;

  @override
  State<RephaseApp> createState() => _RephaseAppState();
}

class _RephaseAppState extends State<RephaseApp> {
  late GoRouter _router;
  String? _accountId;
  String? _routerAccountId;
  bool _resetPending = false;

  Key _screenKey(String screen) =>
      ValueKey('$screen:${widget.controller.account?.id ?? 'guest'}');

  void _accountChanged() {
    final next = widget.controller.account?.id;
    if (next == _accountId) return;
    _accountId = next;
    if (_resetPending) return;
    _resetPending = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final previous = _router;
      setState(() {
        // Indexed-stack navigators retain inactive routes and their arguments.
        // Replace the whole navigation tree when its account changes.
        _routerAccountId = _accountId;
        _router = _createRouter();
        _resetPending = false;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) => previous.dispose());
    });
  }

  GoRouter _createRouter() {
    final controller = widget.controller;
    return GoRouter(
      initialLocation: '/today',
      refreshListenable: controller,
      routes: [
        GoRoute(
          path: '/trips/new',
          builder: (context, state) => TripEditorScreen(
            key: _screenKey('new-trip'),
            controller: controller,
          ),
        ),
        GoRoute(
          path: '/trips/:id/edit',
          builder: (context, state) => TripEditorScreen(
            key: _screenKey('edit-trip:${state.pathParameters['id']}'),
            controller: controller,
            tripId: state.pathParameters['id'],
          ),
        ),
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => _AppShell(shell: shell),
          branches: [
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/today',
                  builder: (context, state) => TodayScreen(
                    key: _screenKey('today'),
                    controller: controller,
                  ),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/plan',
                  builder: (context, state) => PlanScreen(
                    key: _screenKey('plan'),
                    controller: controller,
                    initialDay: state.uri.queryParameters['day'],
                  ),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/trips',
                  builder: (context, state) => TripsScreen(
                    key: _screenKey('trips'),
                    controller: controller,
                  ),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/lounges',
                  builder: (context, state) => LoungesScreen(
                    key: _screenKey('lounges'),
                    airport: state.uri.queryParameters['airport'],
                    legId: state.uri.queryParameters['leg'],
                  ),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/profile',
                  builder: (context, state) =>
                      ProfileScreen(key: _screenKey('profile')),
                ),
              ],
            ),
          ],
        ),
      ],
      errorBuilder: (context, state) => Scaffold(
        body: SafeArea(
          child: Center(
            child: TextButton(
              onPressed: () => context.go('/today'),
              child: const Text('Back to Today'),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    final controller = widget.controller;
    _accountId = controller.account?.id;
    _routerAccountId = _accountId;
    _router = _createRouter();
    controller.addListener(_accountChanged);
    unawaited(controller.initialize());
  }

  @override
  void dispose() {
    widget.controller.removeListener(_accountChanged);
    _router.dispose();
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider.value(
    value: widget.controller,
    child: MaterialApp.router(
      key: ObjectKey(_router),
      title: 'Rephase',
      debugShowCheckedModeBanner: false,
      theme: rephaseTheme(),
      routerConfig: _router,
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: const [Locale('en')],
      builder: (context, child) {
        final controller = context.watch<AppController>();
        if (controller.data == null ||
            _routerAccountId != controller.account?.id) {
          return Scaffold(
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.bedtime_outlined,
                        size: 48,
                        color: violet,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'rephase.',
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const SizedBox(height: 24),
                      if (controller.error == null)
                        const CircularProgressIndicator()
                      else ...[
                        Text(controller.error!, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: controller.initialize,
                          child: const Text('Try again'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          );
        }
        return child!;
      },
    ),
  );
}

class _AppShell extends StatelessWidget {
  const _AppShell({required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final picture = controller.account?.picture;
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bedtime_outlined, color: violet),
            SizedBox(width: 8),
            Text('rephase.', style: TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Profile',
            onPressed: () => context.go('/profile'),
            icon: CircleAvatar(
              radius: 18,
              backgroundColor: const Color(0xff30273f),
              child: picture == null
                  ? const Icon(Icons.person_outline, size: 22, color: violet)
                  : ClipOval(
                      child: Image.network(
                        picture,
                        width: 36,
                        height: 36,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) =>
                            const Icon(Icons.person_outline),
                      ),
                    ),
            ),
          ),
          const SizedBox(width: 8),
        ],
        bottom: controller.planning
            ? const PreferredSize(
                preferredSize: Size.fromHeight(2),
                child: LinearProgressIndicator(minHeight: 2),
              )
            : null,
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            if (controller.error != null || controller.notice != null)
              MaterialBanner(
                content: Text(controller.error ?? controller.notice!),
                actions: [
                  if (controller.signOutNeedsRetry)
                    TextButton(
                      onPressed: controller.signOut,
                      child: const Text('Retry sign out'),
                    ),
                  TextButton(
                    onPressed: controller.clearFeedback,
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
            Expanded(child: shell),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (index) =>
            shell.goBranch(index, initialLocation: index == shell.currentIndex),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.wb_twilight_outlined),
            label: 'Today',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_month_outlined),
            label: 'Your plan',
          ),
          NavigationDestination(
            icon: Icon(Icons.flight_outlined),
            label: 'Trips',
          ),
          NavigationDestination(
            icon: Icon(Icons.chair_outlined),
            label: 'Lounges',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
