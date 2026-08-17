import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/palette.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../shared/authed_image.dart';
import '../../shared/ui.dart';
import '../resident/satisfaction_sheet.dart';

/// Full history of one complaint. Shared by all four roles - what differs is
/// only which actions appear at the bottom.
class ComplaintDetailScreen extends StatefulWidget {
  final String complaintId;

  const ComplaintDetailScreen({super.key, required this.complaintId});

  @override
  State<ComplaintDetailScreen> createState() => _ComplaintDetailScreenState();
}

class _ComplaintDetailScreenState extends State<ComplaintDetailScreen> {
  late Future<_Detail> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Detail> _load() async {
    final res = await context.read<ApiClient>().get('/complaints/${widget.complaintId}');
    return _Detail(
      complaint: Complaint.fromJson(res['complaint'] as Map<String, dynamic>),
      timeline: (res['timeline'] as List)
          .map((t) => TimelineEntry.fromJson(t as Map<String, dynamic>))
          .toList(),
      helpRequests: (res['helpRequests'] as List? ?? const [])
          .cast<Map<String, dynamic>>(),
    );
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();

    return Scaffold(
      appBar: AppBar(title: const Text('Complaint')),
      body: FutureBuilder<_Detail>(
        future: _future,
        builder: (context, snapshot) => AsyncBody<_Detail>(
          snapshot: snapshot,
          onRetry: _refresh,
          builder: (detail) {
            final c = detail.complaint;
            final canConfirm =
                session.role == Role.resident && c.status == 'WORK_DONE';

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 28),
                children: [
                  _Header(complaint: c),

                  if (canConfirm)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                      child: _ConfirmPrompt(
                        complaint: c,
                        onDone: _refresh,
                      ),
                    ),

                  if (c.status == 'REJECTED_INVALID' && c.rejectionReason != null)
                    InfoBanner(
                      icon: Icons.block,
                      color: Palette.critical,
                      text: 'Not accepted: ${c.rejectionReason}',
                    ),

                  if (c.status == 'ESCALATED')
                    InfoBanner(
                      icon: Icons.warning_amber,
                      color: Palette.critical,
                      text: 'With the campus admin. '
                          '${_escalationText(c.escalationReason)}',
                    ),

                  _MediaSection(
                    title: 'REPORTED',
                    media: c.beforeMedia,
                    emptyText: 'No attachments',
                  ),

                  if (c.afterMedia.isNotEmpty)
                    _MediaSection(
                      title: 'AFTER THE WORK',
                      media: c.afterMedia,
                      emptyText: '',
                    ),

                  _PeopleSection(complaint: c),

                  if (detail.helpRequests.isNotEmpty)
                    _HelpRequestSection(requests: detail.helpRequests),

                  _TimelineSection(entries: detail.timeline),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  static String _escalationText(String? reason) => switch (reason) {
        'OFFICER_SLA_BREACH' => 'The zone officer did not allot a worker in time.',
        'WORKER_SLA_BREACH' => 'The worker did not finish in time.',
        'HELP_REQUEST_EXPIRED' => 'No other zone officer answered the request for help.',
        'NO_FREE_WORKER_CAMPUS_WIDE' => 'No worker was free anywhere on campus.',
        'NO_ZONE_OFFICER' => 'That zone has no officer assigned.',
        'REJECTED_TWICE' => 'The resident sent the work back more than once.',
        _ => '',
      };
}

class _Detail {
  final Complaint complaint;
  final List<TimelineEntry> timeline;
  final List<Map<String, dynamic>> helpRequests;

  const _Detail({
    required this.complaint,
    required this.timeline,
    required this.helpRequests,
  });
}

class _Header extends StatelessWidget {
  final Complaint complaint;

  const _Header({required this.complaint});

  @override
  Widget build(BuildContext context) {
    final zoneColor = colorFromHex(complaint.zone?.colorHex ?? '#0072B2');

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Colors.black.withValues(alpha: 0.07))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: zoneColor.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: zoneColor.withValues(alpha: 0.55)),
                ),
                child: Text(
                  complaint.zone?.name ?? 'Zone',
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 9),
              Text(
                complaint.ref,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                  color: Palette.inkSecondary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            categoryLabels[complaint.category] ?? complaint.category,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
              color: Palette.inkPrimary,
            ),
          ),
          if (complaint.description?.isNotEmpty ?? false) ...[
            const SizedBox(height: 6),
            Text(
              complaint.description!,
              style: const TextStyle(
                  fontSize: 14, height: 1.45, color: Palette.inkSecondary),
            ),
          ],
          const SizedBox(height: 14),
          StatusChip(complaint.status),
          const SizedBox(height: 14),
          Row(
            children: [
              _Stat(
                label: 'Reported',
                value: timeAgo(complaint.submittedAt),
              ),
              if (complaint.resolutionMinutes != null)
                _Stat(
                  label: 'Resolved in',
                  value: formatDuration(complaint.resolutionMinutes),
                ),
              if (complaint.reopenCount > 0)
                _Stat(
                  label: 'Sent back',
                  value: '${complaint.reopenCount}x',
                  color: Palette.serious,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _Stat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 26),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 9.5,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: color ?? Palette.inkPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

/// The satisfaction prompt, inline. This is the step the whole system exists
/// for: the person who complained is the only one who can close it.
class _ConfirmPrompt extends StatelessWidget {
  final Complaint complaint;
  final Future<void> Function() onDone;

  const _ConfirmPrompt({required this.complaint, required this.onDone});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Palette.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Palette.warning.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.how_to_reg, color: Palette.warning, size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Is this sorted?',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Compare the photos above. Only you can close this complaint.',
            style: TextStyle(fontSize: 13, height: 1.4, color: Palette.inkSecondary),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: Palette.good,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  onPressed: () async {
                    final ok = await SatisfactionSheet.show(
                      context,
                      complaint: complaint,
                      satisfied: true,
                    );
                    if (ok == true) await onDone();
                  },
                  icon: const Icon(Icons.check_circle_outline, size: 19),
                  label: const Text('Yes, close it'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Palette.serious,
                    side: const BorderSide(color: Palette.serious),
                    minimumSize: const Size.fromHeight(46),
                  ),
                  onPressed: () async {
                    final ok = await SatisfactionSheet.show(
                      context,
                      complaint: complaint,
                      satisfied: false,
                    );
                    if (ok == true) await onDone();
                  },
                  icon: const Icon(Icons.replay, size: 19),
                  label: const Text('Send back'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MediaSection extends StatelessWidget {
  final String title;
  final List<MediaItem> media;
  final String emptyText;

  const _MediaSection({
    required this.title,
    required this.media,
    required this.emptyText,
  });

  @override
  Widget build(BuildContext context) {
    if (media.isEmpty && emptyText.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 10.5,
              letterSpacing: 1.8,
              fontWeight: FontWeight.w700,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 10),
          if (media.isEmpty)
            Text(emptyText, style: const TextStyle(color: Palette.inkMuted))
          else
            SizedBox(
              height: 150,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: media.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (_, i) => _MediaTile(item: media[i]),
              ),
            ),
        ],
      ),
    );
  }
}

class _MediaTile extends StatelessWidget {
  final MediaItem item;

  const _MediaTile({required this.item});

  @override
  Widget build(BuildContext context) {
    if (item.type == 'PHOTO') {
      return AuthedImage(
        path: item.url,
        width: 190,
        height: 150,
        borderRadius: BorderRadius.circular(12),
      );
    }

    return _placeholder(
      item.type == 'VIDEO' ? Icons.videocam_outlined : Icons.mic_none,
      item.type == 'VIDEO'
          ? 'Video${item.durationSec != null ? ' · ${item.durationSec}s' : ''}'
          : 'Voice note${item.durationSec != null ? ' · ${item.durationSec}s' : ''}',
    );
  }

  Widget _placeholder(IconData icon, String label) => Container(
        width: 190,
        height: 150,
        decoration: BoxDecoration(
          color: const Color(0xFFEDF0F3),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 30, color: Palette.inkMuted),
            const SizedBox(height: 8),
            Text(
              label,
              style: const TextStyle(fontSize: 12, color: Palette.inkSecondary),
            ),
          ],
        ),
      );
}

class _PeopleSection extends StatelessWidget {
  final Complaint complaint;

  const _PeopleSection({required this.complaint});

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String, IconData)>[
      if (complaint.reporter != null)
        ('Reported by', complaint.reporter!.name, Icons.person_outline),
      if (complaint.officer != null)
        ('Zone officer', complaint.officer!.name, Icons.badge_outlined),
      if (complaint.worker != null)
        ('Worker', complaint.worker!.name, Icons.cleaning_services_outlined),
    ];

    if (rows.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'WHO IS ON IT',
            style: TextStyle(
              fontSize: 10.5,
              letterSpacing: 1.8,
              fontWeight: FontWeight.w700,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 10),
          for (final (label, name, icon) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Row(
                children: [
                  Icon(icon, size: 17, color: Palette.inkMuted),
                  const SizedBox(width: 9),
                  SizedBox(
                    width: 96,
                    child: Text(
                      label,
                      style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      name,
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w600),
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

class _HelpRequestSection extends StatelessWidget {
  final List<Map<String, dynamic>> requests;

  const _HelpRequestSection({required this.requests});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'HELP BETWEEN ZONES',
            style: TextStyle(
              fontSize: 10.5,
              letterSpacing: 1.8,
              fontWeight: FontWeight.w700,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 10),
          for (final h in requests)
            Container(
              margin: const EdgeInsets.only(bottom: 9),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF7A52CC).withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF7A52CC).withValues(alpha: 0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${(h['fromZone'] as Map?)?['name'] ?? 'A zone'} asked '
                    '${(h['targetZoneCodes'] as List?)?.length ?? 0} nearby zone(s) for a worker',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    switch (h['status'] as String?) {
                      'ACCEPTED' =>
                        '${(h['acceptedByOfficer'] as Map?)?['name'] ?? 'An officer'} lent a worker',
                      'EXPIRED' => 'Nobody answered — escalated to the admin',
                      'OPEN' => 'Waiting for an answer',
                      _ => h['status'] as String? ?? '',
                    },
                    style: const TextStyle(fontSize: 12.5, color: Palette.inkSecondary),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _TimelineSection extends StatelessWidget {
  final List<TimelineEntry> entries;

  const _TimelineSection({required this.entries});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'HISTORY',
            style: TextStyle(
              fontSize: 10.5,
              letterSpacing: 1.8,
              fontWeight: FontWeight.w700,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < entries.length; i++)
            _TimelineRow(
              entry: entries[i],
              isLast: i == entries.length - 1,
            ),
        ],
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  final TimelineEntry entry;
  final bool isLast;

  const _TimelineRow({required this.entry, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final style = StatusStyle.of(entry.to);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 11,
                height: 11,
                margin: const EdgeInsets.only(top: 3),
                decoration: BoxDecoration(
                  color: style.color,
                  shape: BoxShape.circle,
                ),
              ),
              if (!isLast)
                Expanded(
                  child: Container(width: 2, color: Palette.grid),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    style.label,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    entry.isSystem
                        ? 'System · ${formatDateTime(entry.at)}'
                        : '${entry.actorName ?? 'Someone'} · ${formatDateTime(entry.at)}',
                    style: const TextStyle(fontSize: 11.5, color: Palette.inkMuted),
                  ),
                  if (entry.note != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      entry.note!,
                      style: const TextStyle(
                          fontSize: 12.5, height: 1.35, color: Palette.inkSecondary),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
