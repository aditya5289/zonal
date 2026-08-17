import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../core/theme.dart';
import '../../shared/ui.dart';

const _helpPurple = Color(0xFF7A52CC);

/// Officer-to-officer help. Incoming asks from other zones, and the status of
/// the ones this officer has sent out.
class HelpInboxScreen extends StatefulWidget {
  const HelpInboxScreen({super.key});

  @override
  State<HelpInboxScreen> createState() => _HelpInboxScreenState();
}

class _HelpInboxScreenState extends State<HelpInboxScreen> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() =>
      context.read<ApiClient>().get('/officer/help-requests');

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _lend(String helpRequestId, List<Map<String, dynamic>> myFree) async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _PickWorkerSheet(workers: myFree),
    );

    if (chosen == null || !mounted) return;

    try {
      final res = await context.read<ApiClient>().post(
        '/officer/help-requests/$helpRequestId/accept',
        {'workerUserId': chosen},
      );
      if (mounted) {
        showSnack(context, res['message'] as String? ?? 'Worker lent');
        await _refresh();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help between zones')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) => AsyncBody<Map<String, dynamic>>(
          snapshot: snapshot,
          onRetry: _refresh,
          builder: (data) {
            final incoming = (data['incoming'] as List).cast<Map<String, dynamic>>();
            final sent = (data['sent'] as List).cast<Map<String, dynamic>>();
            final myFree = (data['myFreeWorkers'] as List).cast<Map<String, dynamic>>();

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 28),
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(18, 18, 18, 0),
                    child: Text(
                      'ASKING YOU',
                      style: TextStyle(
                        fontSize: 10.5,
                        letterSpacing: 1.8,
                        fontWeight: FontWeight.w700,
                        color: _helpPurple,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),

                  if (incoming.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                      child: Text(
                        'No zone is asking you for a worker.',
                        style: TextStyle(color: Palette.inkMuted),
                      ),
                    )
                  else
                    for (final h in incoming)
                      _IncomingCard(
                        request: h,
                        canLend: myFree.isNotEmpty,
                        onLend: () => _lend(h['id'] as String, myFree),
                      ),

                  if (myFree.isEmpty && incoming.isNotEmpty)
                    const InfoBanner(
                      icon: Icons.info_outline,
                      color: Palette.warning,
                      text: 'You have no free workers to lend right now.',
                    ),

                  const Padding(
                    padding: EdgeInsets.fromLTRB(18, 26, 18, 0),
                    child: Text(
                      'YOU ASKED',
                      style: TextStyle(
                        fontSize: 10.5,
                        letterSpacing: 1.8,
                        fontWeight: FontWeight.w700,
                        color: Palette.inkMuted,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),

                  if (sent.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                      child: Text(
                        'You have not asked another zone for help.',
                        style: TextStyle(color: Palette.inkMuted),
                      ),
                    )
                  else
                    for (final h in sent) _SentCard(request: h),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _IncomingCard extends StatelessWidget {
  final Map<String, dynamic> request;
  final bool canLend;
  final VoidCallback onLend;

  const _IncomingCard({
    required this.request,
    required this.canLend,
    required this.onLend,
  });

  @override
  Widget build(BuildContext context) {
    final complaint = request['complaint'] as Map<String, dynamic>?;
    final fromZone = request['fromZone'] as Map<String, dynamic>?;
    final fromOfficer = request['fromOfficer'] as Map<String, dynamic>?;
    final expiresAt = DateTime.tryParse(request['expiresAt'] as String? ?? '')?.toLocal();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: _helpPurple.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: _helpPurple.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.handshake, color: _helpPurple, size: 20),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  '${fromZone?['name'] ?? 'A zone'} needs a worker',
                  style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${fromOfficer?['name'] ?? 'The officer'} has nobody free in '
            '${fromZone?['label'] ?? 'their zone'}.',
            style: const TextStyle(
                fontSize: 13, height: 1.35, color: Palette.inkSecondary),
          ),
          const SizedBox(height: 12),
          if (complaint != null)
            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Row(
                children: [
                  Icon(
                    categoryIcons[complaint['category']] ?? Icons.more_horiz,
                    size: 17,
                    color: Palette.inkSecondary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${complaint['ref']} · '
                      '${categoryLabels[complaint['category']] ?? complaint['category']}',
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          if (expiresAt != null) ...[
            const SizedBox(height: 9),
            Row(
              children: [
                const Icon(Icons.schedule, size: 14, color: Palette.inkMuted),
                const SizedBox(width: 5),
                Text(
                  'Goes to the admin ${_relative(expiresAt)}',
                  style: const TextStyle(fontSize: 11.5, color: Palette.inkMuted),
                ),
              ],
            ),
          ],
          const SizedBox(height: 13),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: _helpPurple,
              minimumSize: const Size.fromHeight(44),
            ),
            onPressed: canLend ? onLend : null,
            icon: const Icon(Icons.person_add_alt, size: 19),
            label: Text(canLend ? 'Lend a worker' : 'No free workers'),
          ),
        ],
      ),
    );
  }

  static String _relative(DateTime when) {
    final diff = when.difference(DateTime.now());
    if (diff.isNegative) return 'shortly';
    if (diff.inMinutes < 60) return 'in ${diff.inMinutes} min';
    return 'in ${diff.inHours}h';
  }
}

class _SentCard extends StatelessWidget {
  final Map<String, dynamic> request;

  const _SentCard({required this.request});

  @override
  Widget build(BuildContext context) {
    final complaint = request['complaint'] as Map<String, dynamic>?;
    final status = request['status'] as String? ?? 'OPEN';
    final acceptedBy = request['acceptedByOfficer'] as Map<String, dynamic>?;

    final (icon, color, text) = switch (status) {
      'ACCEPTED' => (
          Icons.check_circle,
          Palette.good,
          '${acceptedBy?['name'] ?? 'An officer'} lent you a worker',
        ),
      'EXPIRED' => (
          Icons.timer_off,
          Palette.critical,
          'Nobody answered — sent to the admin',
        ),
      'CANCELLED' => (Icons.cancel_outlined, Palette.inkMuted, 'Cancelled'),
      _ => (Icons.hourglass_top, Palette.warning, 'Waiting for an answer'),
    };

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.black.withValues(alpha: 0.08)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  complaint?['ref'] as String? ?? 'Complaint',
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  text,
                  style: TextStyle(fontSize: 12.5, color: color),
                ),
              ],
            ),
          ),
          Text(
            timeAgo(DateTime.tryParse(request['createdAt'] as String? ?? '')?.toLocal()),
            style: const TextStyle(fontSize: 11, color: Palette.inkMuted),
          ),
        ],
      ),
    );
  }
}

class _PickWorkerSheet extends StatelessWidget {
  final List<Map<String, dynamic>> workers;

  const _PickWorkerSheet({required this.workers});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Palette.grid,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Which worker will you lend?',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          const Text(
            'They stay on your roster — they just do this one job in the other zone.',
            style: TextStyle(fontSize: 13, height: 1.35, color: Palette.inkSecondary),
          ),
          const SizedBox(height: 18),
          for (final w in workers)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: _helpPurple.withValues(alpha: 0.14),
                child: Text(
                  (w['name'] as String).isEmpty
                      ? '?'
                      : (w['name'] as String)[0].toUpperCase(),
                  style: const TextStyle(
                    color: _helpPurple,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              title: Text(
                w['name'] as String,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text('${w['tasksCompletedToday'] ?? 0} done today'),
              trailing: const Icon(Icons.arrow_forward_ios, size: 15),
              onTap: () => Navigator.of(context).pop(w['userId'] as String),
            ),
        ],
      ),
    );
  }
}
