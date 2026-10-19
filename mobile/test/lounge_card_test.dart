import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/features/lounges/lounges_screen.dart';

void main() {
  testWidgets(
    'conditional access stays explicit and details expand without crowding the card',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(useMaterial3: true),
          home: const Scaffold(
            body: SingleChildScrollView(
              child: LoungeResultCard(
                result: {
                  'lounge': {
                    'name': 'Qantas International Business Lounge',
                    'terminal': 'Tom Bradley International Terminal',
                    'location': 'Level 5, after security',
                    'airside': true,
                    'amenities': {
                      'showers': 'yes',
                      'dining': 'buffet',
                      'spa': 'unknown',
                    },
                    'hours': {
                      'type': 'weekly',
                      'periods': [
                        {
                          'days': [1, 2, 3, 4, 5, 6, 7],
                          'open': '06:00',
                          'close': '23:00',
                        },
                      ],
                    },
                    'sources': [
                      {
                        'title': 'Qantas lounge access',
                        'url': 'https://www.qantas.com/',
                      },
                    ],
                    'photos': [],
                  },
                  'access': 'conditional',
                  'opening': 'open',
                  'recommended': false,
                  'reasons': ['Your membership matches this access route.'],
                  'warnings': [
                    'Confirm the operating carrier and terminal access.',
                  ],
                },
              ),
            ),
          ),
        ),
      );
      expect(find.text('Conditional access'), findsOneWidget);
      expect(find.text('Showers'), findsOneWidget);
      expect(find.text('Spa'), findsNothing);
      expect(find.text('Recommended'), findsNothing);
      expect(
        find.text('Confirm the operating carrier and terminal access.'),
        findsNothing,
      );
      await tester.tap(find.text('Access, hours & details'));
      await tester.pumpAndSettle();
      expect(
        find.text('Confirm the operating carrier and terminal access.'),
        findsOneWidget,
      );
      expect(find.text('Daily · 06:00–23:00'), findsOneWidget);
      expect(find.text('Qantas lounge access'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
