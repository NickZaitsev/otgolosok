import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/i18n/i18n.dart';
import '../core/links/app_links.dart';
import '../features/account/account_screen.dart';
import '../features/account/my_walks_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/explore/explore_screen.dart';
import '../features/walk_builder/builder_screen.dart';
import '../features/walks/library_screen.dart';
import '../features/walks/trends_screen.dart';
import '../features/walks/walk_link.dart';
import '../features/walks/walk_screen.dart';
import 'providers.dart';

/// Whether a walk is running; links that would leave it ask first (site `confirmLeave`).
final walkActiveProvider = NotifierProvider<WalkActive, bool>(WalkActive.new);

class WalkActive extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool active) => state = active;
}

/// Routes mirror the site URLs: `/`, `/builder` (site `/?walk=create`), `/trends`, `/account`,
/// `/account/walks`, `/history`, `/walk?…`, `/login`. Incoming App Links are mapped by [inAppLocation].
final routerProvider = Provider<GoRouter>((ref) {
  final origin = ref.watch(configProvider).origin;
  final router = GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final uri = state.uri;
      if (uri.path.startsWith('/place/') || uri.path.startsWith('/en') || uri.path.startsWith('/zh')) {
        return inAppLocation(uri, origin) ?? '/';
      }
      return null;
    },
    errorBuilder: (context, state) => const _NotFound(),
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/', builder: (context, state) => ExploreScreen(placeId: _placeParam(state.uri))),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/builder', builder: (context, state) => BuilderScreen(query: state.uri.queryParameters))]),
          StatefulShellBranch(routes: [GoRoute(path: '/trends', builder: (context, state) => const TrendsScreen())]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/account',
              builder: (context, state) => const AccountScreen(),
              routes: [GoRoute(path: 'walks', builder: (context, state) => const MyWalksScreen())],
            ),
          ]),
        ],
      ),
      GoRoute(path: '/history', builder: (context, state) => LibraryScreen(tab: state.uri.queryParameters['tab'])),
      GoRoute(
        path: '/walk',
        builder: (context, state) {
          final link = WalkLink.parse(state.uri.queryParameters);
          return link == null ? const _NotFound() : WalkScreen(link: link);
        },
      ),
      GoRoute(path: '/login', builder: (context, state) => LoginScreen(returnTo: state.uri.queryParameters['returnTo'])),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

String? _placeParam(Uri uri) {
  final value = uri.queryParameters['place'];
  return isPlaceId(value) ? value : null;
}

/// The bottom island: «Рядом», «Прогулка», «Тренды», «Профиль» as the site's app-navigation.tsx.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (index) => shell.goBranch(index, initialLocation: index == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.map_outlined), selectedIcon: const Icon(Icons.map), label: context.t('Рядом')),
          NavigationDestination(icon: const Icon(Icons.add_circle_outline), selectedIcon: const Icon(Icons.add_circle), label: context.t('Прогулка')),
          NavigationDestination(icon: const Icon(Icons.trending_up), label: context.t('Тренды')),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: context.t('Профиль')),
        ],
      ),
    );
  }
}

class _NotFound extends StatelessWidget {
  const _NotFound();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(context.t('Страница не найдена')),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => context.go('/'), child: Text(context.t('На главную'))),
          ]),
        ),
      );
}
