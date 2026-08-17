import 'package:flutter/material.dart';

import '../core/palette.dart';
import '../core/theme.dart';

/// One cell's live data.
class ZoneCellData {
  final int code;
  final String name;
  final String label;
  final String colorHex;
  final int openCount;
  final int workersFree;
  final int workersTotal;

  const ZoneCellData({
    required this.code,
    required this.name,
    required this.label,
    required this.colorHex,
    this.openCount = 0,
    this.workersFree = 0,
    this.workersTotal = 0,
  });
}

/// The campus, as it actually is: eight zones ringing a central park.
///
/// This is the project's one signature element, lifted straight from the
/// layout the whole system is organised around. It is not decoration - the
/// spatial arrangement is the information. An officer glancing at it sees
/// which neighbouring zone has spare workers, which is precisely the decision
/// the help-request flow asks them to make.
///
///     Z2  Z1  Z8
///     Z3  []  Z7
///     Z4  Z5  Z6
class ZoneGrid extends StatelessWidget {
  final List<ZoneCellData> zones;
  final void Function(ZoneCellData zone)? onTap;

  /// Draws a ring around this zone - the viewer's own zone.
  final int? highlightCode;

  /// What the number in each cell means.
  final ZoneGridMetric metric;

  const ZoneGrid({
    super.key,
    required this.zones,
    this.onTap,
    this.highlightCode,
    this.metric = ZoneGridMetric.openComplaints,
  });

  static const _layout = [
    [2, 1, 8],
    [3, null, 7],
    [4, 5, 6],
  ];

  @override
  Widget build(BuildContext context) {
    final byCode = {for (final z in zones) z.code: z};

    return AspectRatio(
      aspectRatio: 1,
      child: Column(
        children: [
          for (final row in _layout)
            Expanded(
              child: Row(
                children: [
                  for (final code in row)
                    Expanded(
                      child: code == null
                          ? const _ParkCell()
                          : _ZoneCell(
                              data: byCode[code],
                              code: code,
                              metric: metric,
                              highlighted: highlightCode == code,
                              onTap: byCode[code] == null || onTap == null
                                  ? null
                                  : () => onTap!(byCode[code]!),
                            ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

enum ZoneGridMetric { openComplaints, freeWorkers }

class _ParkCell extends StatelessWidget {
  const _ParkCell();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF4EC),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFD7E3D2)),
      ),
      child: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.park_outlined, size: 18, color: Color(0xFF7A8F72)),
            SizedBox(height: 3),
            Text(
              'PARK',
              style: TextStyle(
                fontSize: 8.5,
                letterSpacing: 1.1,
                fontWeight: FontWeight.w700,
                color: Color(0xFF7A8F72),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ZoneCell extends StatelessWidget {
  final ZoneCellData? data;
  final int code;
  final ZoneGridMetric metric;
  final bool highlighted;
  final VoidCallback? onTap;

  const _ZoneCell({
    required this.data,
    required this.code,
    required this.metric,
    required this.highlighted,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = data != null
        ? colorFromHex(data!.colorHex)
        : (Palette.zoneRing[code] ?? Palette.neutral);

    final value = switch (metric) {
      ZoneGridMetric.openComplaints => data?.openCount ?? 0,
      ZoneGridMetric.freeWorkers => data?.workersFree ?? 0,
    };

    // The number is the signal, so it carries the weight. The fill is a tint
    // and the zone name is always drawn - the fill alone never identifies a
    // zone, because three of the eight hues fall under 3:1 on white.
    return Semantics(
      button: onTap != null,
      label: data == null
          ? 'Zone $code'
          : '${data!.name}, ${data!.label}, $value '
              '${metric == ZoneGridMetric.openComplaints ? 'open complaints' : 'free workers'}',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            margin: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: highlighted ? color : color.withValues(alpha: 0.45),
                width: highlighted ? 2.5 : 1,
              ),
            ),
            child: Stack(
              children: [
                // Zone number, top-left, in its own hue at full strength.
                Positioned(
                  top: 5,
                  left: 6,
                  child: Text(
                    '$code',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3,
                      color: color,
                    ),
                  ),
                ),
                Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '$value',
                        style: TextStyle(
                          fontSize: 21,
                          height: 1,
                          fontWeight: FontWeight.w800,
                          color: value == 0 ? Palette.inkMuted : Palette.inkPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        metric == ZoneGridMetric.openComplaints ? 'open' : 'free',
                        style: const TextStyle(
                          fontSize: 8.5,
                          letterSpacing: 0.6,
                          fontWeight: FontWeight.w600,
                          color: Palette.inkMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Legend for the grid. Keeps identity out of colour-alone territory by
/// pairing every swatch with its zone name.
class ZoneGridLegend extends StatelessWidget {
  final List<ZoneCellData> zones;

  const ZoneGridLegend({super.key, required this.zones});

  @override
  Widget build(BuildContext context) {
    final sorted = [...zones]..sort((a, b) => a.code.compareTo(b.code));

    return Wrap(
      spacing: 10,
      runSpacing: 6,
      children: [
        for (final z in sorted)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: colorFromHex(z.colorHex),
                  borderRadius: BorderRadius.circular(2.5),
                ),
              ),
              const SizedBox(width: 5),
              Text(
                '${z.name} · ${z.label}',
                style: const TextStyle(fontSize: 11, color: Palette.inkSecondary),
              ),
            ],
          ),
      ],
    );
  }
}
