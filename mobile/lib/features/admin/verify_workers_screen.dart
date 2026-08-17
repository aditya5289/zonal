import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/palette.dart';
import '../../shared/authed_image.dart';
import '../../shared/ui.dart';

/// The worker onboarding gate. Until an admin approves someone here, the
/// server refuses to allot them a single task.
class VerifyWorkersScreen extends StatefulWidget {
  const VerifyWorkersScreen({super.key});

  @override
  State<VerifyWorkersScreen> createState() => _VerifyWorkersScreenState();
}

class _VerifyWorkersScreenState extends State<VerifyWorkersScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _statuses = ['PENDING', 'ACTIVE', 'REJECTED'];

  late Future<List<Map<String, dynamic>>> _future;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _tabs.addListener(() {
      if (_tabs.indexIsChanging) return;
      setState(() {
        _index = _tabs.index;
        // The hide-list is per-tab: someone just approved belongs in Active,
        // so it must not follow them across.
        _decided.clear();
        _future = _load();
      });
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final res = await context
        .read<ApiClient>()
        .get('/admin/workers', query: {'status': _statuses[_index]});
    return (res['workers'] as List).cast<Map<String, dynamic>>();
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  /// Workers decided in this session. Removed from the list the moment the
  /// server confirms, rather than waiting for the refetch - a card that stays
  /// put after you act on it reads as "the button did nothing".
  final Set<String> _decided = {};

  Future<void> _decide(Map<String, dynamic> worker, bool approve) async {
    String? note;

    if (!approve) {
      note = await showDialog<String>(
        context: context,
        builder: (_) => const _RejectDialog(),
      );
      if (note == null) return;
    }

    // The dialog was awaited, so this screen may have been disposed by now.
    if (!mounted) return;

    try {
      final res = await context.read<ApiClient>().post(
        '/admin/workers/${worker['userId']}/verify',
        {'approve': approve, if (note != null) 'note': note},
      );
      if (mounted) {
        setState(() => _decided.add(worker['userId'] as String));
        showSnack(
          context,
          res['message'] as String? ?? (approve ? 'Verified' : 'Rejected'),
        );
        await _refresh();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workers'),
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: Colors.white,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: const [
            Tab(text: 'To verify'),
            Tab(text: 'Active'),
            Tab(text: 'Rejected'),
          ],
        ),
      ),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) => AsyncBody<List<Map<String, dynamic>>>(
          snapshot: snapshot,
          onRetry: _refresh,
          builder: (all) {
            // Drop anyone decided in this session so the card clears at once.
            final workers = all
                .where((w) => !_decided.contains(w['userId'] as String))
                .toList();

            if (workers.isEmpty) {
              return EmptyState(
                icon: switch (_index) {
                  0 => Icons.done_all,
                  1 => Icons.groups_outlined,
                  _ => Icons.person_off_outlined,
                },
                title: switch (_index) {
                  0 => 'Nobody waiting',
                  1 => 'No active workers',
                  _ => 'Nobody rejected',
                },
                subtitle: _index == 0
                    ? 'New worker registrations appear here for you to check.'
                    : null,
              );
            }

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: workers.length,
                itemBuilder: (_, i) => _WorkerCard(
                  worker: workers[i],
                  showActions: _index == 0,
                  onApprove: () => _decide(workers[i], true),
                  onReject: () => _decide(workers[i], false),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _WorkerCard extends StatelessWidget {
  final Map<String, dynamic> worker;
  final bool showActions;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  const _WorkerCard({
    required this.worker,
    required this.showActions,
    required this.onApprove,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final zone = worker['zone'] as Map<String, dynamic>?;
    final idProof = worker['idProofUrl'] as String?;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 21,
                  backgroundColor: Palette.grid,
                  child: Text(
                    (worker['name'] as String).isEmpty
                        ? '?'
                        : (worker['name'] as String)[0].toUpperCase(),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: Palette.inkSecondary,
                    ),
                  ),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        worker['name'] as String,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${worker['email']}'
                        '${worker['phone'] != null ? ' · ${worker['phone']}' : ''}',
                        style: const TextStyle(
                            fontSize: 12.5, color: Palette.inkSecondary),
                      ),
                      const SizedBox(height: 7),
                      if (zone != null)
                        Container(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: Palette.inkPrimary.withValues(alpha: 0.06),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            '${zone['name']} · ${zone['label']}',
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                Text(
                  timeAgo(DateTime.tryParse(
                          worker['registeredAt'] as String? ?? '')
                      ?.toLocal()),
                  style: const TextStyle(fontSize: 11, color: Palette.inkMuted),
                ),
              ],
            ),

            if (idProof != null) ...[
              const SizedBox(height: 13),
              const Text(
                'ID PROOF',
                style: TextStyle(
                  fontSize: 9.5,
                  letterSpacing: 1.3,
                  fontWeight: FontWeight.w700,
                  color: Palette.inkMuted,
                ),
              ),
              const SizedBox(height: 7),
              AuthedImage(
                path: idProof,
                height: 150,
                width: double.infinity,
                borderRadius: BorderRadius.circular(10),
              ),
            ] else if (showActions) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Palette.warning.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, size: 16, color: Palette.warning),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'No ID photo was uploaded',
                        style: TextStyle(fontSize: 12.5, color: Palette.warning),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            if (showActions) ...[
              const SizedBox(height: 15),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: Palette.good,
                        minimumSize: const Size.fromHeight(44),
                      ),
                      onPressed: onApprove,
                      icon: const Icon(Icons.check, size: 19),
                      label: const Text('Verify'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Palette.critical,
                        side: const BorderSide(color: Palette.critical),
                        minimumSize: const Size.fromHeight(44),
                      ),
                      onPressed: onReject,
                      icon: const Icon(Icons.close, size: 19),
                      label: const Text('Reject'),
                    ),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  _Pill(
                    text: worker['dutyStatus'] == 'ON' ? 'On duty' : 'Off duty',
                    color: worker['dutyStatus'] == 'ON'
                        ? Palette.good
                        : Palette.inkMuted,
                  ),
                  const SizedBox(width: 7),
                  _Pill(
                    text: worker['availability'] == 'AVAILABLE' ? 'Free' : 'Busy',
                    color: worker['availability'] == 'AVAILABLE'
                        ? Palette.good
                        : Palette.warning,
                  ),
                  const Spacer(),
                  Text(
                    '${worker['tasksCompletedTotal'] ?? 0} tasks done',
                    style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color color;

  const _Pill({required this.text, required this.color});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          text,
          style: TextStyle(
              fontSize: 11.5, fontWeight: FontWeight.w700, color: color),
        ),
      );
}

class _RejectDialog extends StatefulWidget {
  const _RejectDialog();

  @override
  State<_RejectDialog> createState() => _RejectDialogState();
}

class _RejectDialogState extends State<_RejectDialog> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Reject this registration'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'The worker sees this reason on their screen.',
            style: TextStyle(fontSize: 13, color: Palette.inkSecondary),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _note,
            maxLines: 3,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: 'Why is it being rejected?'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Palette.critical),
          onPressed: () => Navigator.of(context).pop(
            _note.text.trim().isEmpty ? 'Not approved' : _note.text.trim(),
          ),
          child: const Text('Reject'),
        ),
      ],
    );
  }
}
