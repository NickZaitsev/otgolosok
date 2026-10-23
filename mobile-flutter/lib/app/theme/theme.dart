import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// The site's «Читальня» palette from tokens.css. Android has no Georgia/Arial: headings use the
/// platform serif (Noto Serif), body text the platform sans (Roboto).
abstract final class AppTheme {
  static const serif = 'serif';

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: TokenColors.mapGreen,
      brightness: Brightness.light,
    ).copyWith(
      primary: TokenColors.mapGreen,
      onPrimary: TokenColors.onDark,
      secondary: TokenColors.mapOrange,
      onSecondary: TokenColors.onDark,
      tertiary: TokenColors.teal,
      error: TokenColors.dangerInk,
      surface: TokenColors.paper,
      onSurface: TokenColors.ink,
      onSurfaceVariant: TokenColors.muted,
      surfaceContainerLowest: TokenColors.fieldSurface,
      surfaceContainerLow: TokenColors.raised,
      surfaceContainer: TokenColors.surfaceIsland,
      surfaceContainerHigh: TokenColors.sunken,
      outline: TokenColors.fieldBorder,
      outlineVariant: TokenColors.controlBorder,
    );
    const minControl = Size(TokenSizes.controlPrimaryMin, TokenSizes.controlPrimaryMin);
    final pill = RoundedRectangleBorder(borderRadius: BorderRadius.circular(TokenSizes.radiusPill));
    const label = TextStyle(fontSize: TokenSizes.textControl, fontWeight: FontWeight.w700, height: TokenNumbers.leadingControl);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: TokenColors.paper,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
      textTheme: _text(TokenColors.ink),
      dividerColor: TokenColors.line,
      appBarTheme: const AppBarTheme(
        backgroundColor: TokenColors.paper,
        foregroundColor: TokenColors.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: TokenSizes.navH + 12,
        backgroundColor: TokenColors.surfaceIsland,
        indicatorColor: TokenColors.controlSelected,
        labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: TokenSizes.textMeta, fontWeight: FontWeight.w600)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: minControl,
          shape: pill,
          backgroundColor: TokenColors.mapOrange,
          foregroundColor: TokenColors.surfaceIsland,
          textStyle: label,
          padding: const EdgeInsets.symmetric(horizontal: 18),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: minControl,
          shape: pill,
          foregroundColor: TokenColors.mapGreen,
          side: const BorderSide(color: Color(0x33203E38)),
          textStyle: label,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: minControl, foregroundColor: TokenColors.mapGreen, textStyle: label),
      ),
      iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: minControl)),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TokenColors.fieldSurface,
        constraints: const BoxConstraints(minHeight: TokenSizes.fieldMin),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
          borderSide: const BorderSide(color: TokenColors.fieldBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
          borderSide: const BorderSide(color: TokenColors.fieldBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TokenSizes.radiusSm),
          borderSide: const BorderSide(color: TokenColors.focus, width: 2),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: TokenColors.surfaceIsland,
        showDragHandle: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(TokenSizes.radiusIsland))),
      ),
      cardTheme: CardThemeData(
        color: TokenColors.raised,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TokenSizes.radiusMd),
          side: const BorderSide(color: TokenColors.line),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }

  static TextTheme _text(Color ink) {
    TextStyle style(double size, FontWeight weight, double height, {String? family}) =>
        TextStyle(fontSize: size, fontWeight: weight, height: height, color: ink, fontFamily: family);
    return TextTheme(
      headlineLarge: style(TokenSizes.textPage, FontWeight.w700, TokenNumbers.leadingTight, family: serif),
      headlineMedium: style(TokenSizes.textSubtitle, FontWeight.w700, TokenNumbers.leadingTight, family: serif),
      titleLarge: style(TokenSizes.textSection, FontWeight.w700, TokenNumbers.leadingTight),
      titleMedium: style(TokenSizes.textControl, FontWeight.w700, TokenNumbers.leadingControl),
      bodyLarge: style(TokenSizes.textBody, FontWeight.w400, TokenNumbers.leadingBody, family: serif),
      bodyMedium: style(TokenSizes.textSheetBody, FontWeight.w400, TokenNumbers.leadingControl),
      bodySmall: style(TokenSizes.textSecondary, FontWeight.w400, TokenNumbers.leadingControl).copyWith(color: TokenColors.muted),
      labelLarge: style(TokenSizes.textControl, FontWeight.w700, TokenNumbers.leadingControl),
      labelMedium: style(TokenSizes.textSecondary, FontWeight.w600, TokenNumbers.leadingControl),
      labelSmall: style(TokenSizes.textMeta, FontWeight.w600, TokenNumbers.leadingControl).copyWith(color: TokenColors.muted),
    );
  }
}
