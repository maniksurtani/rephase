import 'package:flutter/material.dart';
import 'common.dart';

ThemeData rephaseTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: violet,
    brightness: Brightness.dark,
    surface: night,
    primary: violet,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: night,
    appBarTheme: const AppBarTheme(
      backgroundColor: night,
      surfaceTintColor: Colors.transparent,
    ),
    cardTheme: CardThemeData(
      color: panel,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 14),
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0xff34354b)),
        borderRadius: BorderRadius.circular(20),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xff151622),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: Color(0xff151622),
      indicatorColor: Color(0xff34283f),
    ),
    expansionTileTheme: const ExpansionTileThemeData(
      shape: Border(),
      collapsedShape: Border(),
      childrenPadding: EdgeInsets.fromLTRB(16, 0, 16, 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(44, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
  );
}
