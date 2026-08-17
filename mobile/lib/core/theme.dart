import 'package:flutter/material.dart';

/// Turns the "#RRGGBB" strings the API sends into Flutter colours.
Color colorFromHex(String hex, {Color fallback = const Color(0xFF4F86C6)}) {
  final cleaned = hex.replaceAll('#', '').trim();
  if (cleaned.length != 6) return fallback;
  final value = int.tryParse(cleaned, radix: 16);
  return value == null ? fallback : Color(0xFF000000 | value);
}

class AppTheme {
  static const seed = Color(0xFF1B4F72); // the poster's deep navy
  static const accent = Color(0xFF27AE60);

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(seedColor: seed);

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFFF6F7F9),
      appBarTheme: const AppBarTheme(
        backgroundColor: seed,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: Colors.black.withValues(alpha: 0.07)),
        ),
        color: Colors.white,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      chipTheme: const ChipThemeData(side: BorderSide.none),
    );
  }
}

/// Presentation for each complaint status: what the user sees and its colour.
class StatusStyle {
  final String label;
  final Color color;
  final IconData icon;

  const StatusStyle(this.label, this.color, this.icon);

  static StatusStyle of(String status) => switch (status) {
        'SUBMITTED' => const StatusStyle('Submitted', Color(0xFF7F8C8D), Icons.upload_file),
        'UNDER_REVIEW' =>
          const StatusStyle('Awaiting admin verification', Color(0xFFE67E22), Icons.gavel),
        'REJECTED_INVALID' =>
          const StatusStyle('Rejected by admin', Color(0xFFC0392B), Icons.block),
        // Says "verified" explicitly. The old label read "With the zone
        // officer", which to an officer looking at their own queue was
        // indistinguishable from the unverified state they just acted on.
        'ALLOTTED_TO_OFFICER' =>
          const StatusStyle('Verified · needs a worker', Color(0xFF2980B9), Icons.verified),
        'HELP_REQUESTED' =>
          const StatusStyle('Asking a nearby zone for help', Color(0xFF8E44AD), Icons.handshake),
        'ALLOTTED_TO_WORKER' =>
          const StatusStyle('Worker assigned', Color(0xFF16A085), Icons.assignment_ind),
        'IN_PROGRESS' => const StatusStyle('Work in progress', Color(0xFF2C82C9), Icons.cleaning_services),
        'WORK_DONE' =>
          const StatusStyle('Awaiting your confirmation', Color(0xFFF39C12), Icons.how_to_reg),
        'REOPENED' => const StatusStyle('Sent back for rework', Color(0xFFD35400), Icons.replay),
        'ESCALATED' => const StatusStyle('Escalated to admin', Color(0xFFC0392B), Icons.warning_amber),
        'CLOSED' => const StatusStyle('Closed', Color(0xFF27AE60), Icons.check_circle),
        'AUTO_CLOSED' =>
          const StatusStyle('Closed automatically', Color(0xFF95A5A6), Icons.timer_off),
        _ => StatusStyle(status, const Color(0xFF7F8C8D), Icons.help_outline),
      };
}

/// Human labels for the complaint categories.
const categoryLabels = <String, String>{
  'GARBAGE': 'Garbage / litter',
  'OVERFLOWING_BIN': 'Overflowing bin',
  'WASHROOM': 'Dirty washroom',
  'WATER_LOGGING': 'Water logging',
  'DRAINAGE': 'Blocked drainage',
  'PEST': 'Pests / insects',
  'OTHER': 'Other',
};

const categoryIcons = <String, IconData>{
  'GARBAGE': Icons.delete_outline,
  'OVERFLOWING_BIN': Icons.delete_forever_outlined,
  'WASHROOM': Icons.wc_outlined,
  'WATER_LOGGING': Icons.water_damage_outlined,
  'DRAINAGE': Icons.plumbing_outlined,
  'PEST': Icons.pest_control_outlined,
  'OTHER': Icons.more_horiz,
};
