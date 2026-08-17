import 'package:flutter/material.dart';

/// Colour decisions for the app, split by the JOB each colour does.
///
/// The rule that drives all of this: colour is assigned by job, not by taste.
/// Identity gets categorical hues, magnitude gets one hue light-to-dark, state
/// gets the reserved status set, and those three never borrow from each other.
class Palette {
  // ---------------------------------------------------------------------
  // 1. CATEGORICAL - identity only (the 8 zones on the map)
  // ---------------------------------------------------------------------

  /// Zone fills, in ring order around the central park. Validated
  /// colourblind-safe; see the note in prisma/seed.js for why the poster's
  /// original pastels were replaced.
  ///
  /// The server sends each zone's colour, so the app normally reads it from
  /// the API. This is the fallback and the single source of truth for anything
  /// rendered before the zones have loaded.
  static const zoneRing = <int, Color>{
    1: Color(0xFF0072B2), // blue
    8: Color(0xFFE69F00), // orange
    7: Color(0xFF009E73), // green
    6: Color(0xFF7A52CC), // purple
    5: Color(0xFF56B4E9), // sky
    4: Color(0xFFD55E00), // vermillion
    3: Color(0xFFCC79A7), // pink
    2: Color(0xFF6E8B00), // olive
  };

  /// Three of the zone hues sit under 3:1 contrast on white, so a zone must
  /// never be identified by its fill alone - always draw the zone name too.
  static const zoneRequiresLabel = true;

  // ---------------------------------------------------------------------
  // 2. SEQUENTIAL - magnitude (complaints per zone, per category, heatmap)
  // ---------------------------------------------------------------------

  /// One hue, light to dark. Used wherever a bar's length already carries the
  /// value and the axis label already carries identity - painting those bars
  /// in 8 different colours would encode nothing and just add noise.
  static const sequential = <Color>[
    Color(0xFFDCEAF6),
    Color(0xFFB3D2EA),
    Color(0xFF7FB2DA),
    Color(0xFF4A8FC7),
    Color(0xFF0072B2),
    Color(0xFF00558A),
  ];

  /// Pick a step for a 0..1 fraction of the maximum.
  static Color sequentialStep(double t) {
    if (t.isNaN) return sequential.first;
    final clamped = t.clamp(0.0, 1.0);
    final index = (clamped * (sequential.length - 1)).round();
    return sequential[index];
  }

  // ---------------------------------------------------------------------
  // 3. STATUS - reserved, never reused as a "series colour"
  // ---------------------------------------------------------------------

  static const good = Color(0xFF2E7D32);
  static const warning = Color(0xFFE69F00);
  static const serious = Color(0xFFD55E00);
  static const critical = Color(0xFFC62828);
  static const neutral = Color(0xFF6B7785);

  /// Status colours always ship alongside an icon and a label, never alone.
  static Color forComplaintStatus(String status) => switch (status) {
        'CLOSED' => good,
        'AUTO_CLOSED' => neutral,
        'REJECTED_INVALID' => critical,
        'ESCALATED' => critical,
        'HELP_REQUESTED' => serious,
        'REOPENED' => serious,
        'WORK_DONE' => warning,
        'UNDER_REVIEW' => warning,
        _ => const Color(0xFF0072B2),
      };

  // ---------------------------------------------------------------------
  // 4. INK - text never wears a series colour
  // ---------------------------------------------------------------------

  static const inkPrimary = Color(0xFF1A2027);
  static const inkSecondary = Color(0xFF4A5568);
  static const inkMuted = Color(0xFF8A94A6);
  static const grid = Color(0xFFE4E8ED);
}
