import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/palette.dart';
import '../../core/session.dart';
import '../../core/theme.dart';

/// What an officer sees between signing up and being appointed.
///
/// The officer dashboard is built entirely around owning a zone, so showing it
/// to someone who owns none would be a screen of empty lists that looks broken
/// rather than pending. This says plainly which zone was applied for and what
/// happens next.
class OfficerPendingScreen extends StatelessWidget {
  const OfficerPendingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final application = session.user?.officer;
    final rejected = application?.isRejected ?? false;
    final zone = application?.zone;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Zone Officer'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => session.logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: session.refreshUser,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 40, 22, 30),
          children: [
            Icon(
              rejected ? Icons.cancel_outlined : Icons.verified_user_outlined,
              size: 64,
              color: rejected ? Palette.critical : AppTheme.seed,
            ),
            const SizedBox(height: 22),
            Text(
              rejected ? 'Application not approved' : 'Waiting for approval',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            Text(
              rejected
                  ? (application?.rejectionNote ??
                      'The campus admin did not approve your application.')
                  : zone == null
                      ? 'The campus admin is reviewing your application.'
                      : 'You have applied to run ${zone.name} — ${zone.label}. '
                          'The campus admin reviews this, and the zone becomes '
                          'yours once they approve.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                height: 1.45,
                color: Palette.inkSecondary,
              ),
            ),
            if (!rejected) ...[
              const SizedBox(height: 30),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Palette.inkMuted.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ONCE APPROVED',
                      style: TextStyle(
                        fontSize: 10.5,
                        letterSpacing: 1.8,
                        fontWeight: FontWeight.w700,
                        color: Palette.inkMuted,
                      ),
                    ),
                    SizedBox(height: 12),
                    _Step(
                      icon: Icons.inbox_outlined,
                      text: 'Complaints from your zone arrive with you directly.',
                    ),
                    _Step(
                      icon: Icons.groups_outlined,
                      text: 'You allot each one to a free worker in your zone.',
                    ),
                    _Step(
                      icon: Icons.handshake_outlined,
                      text: 'When everyone is busy, you can ask a neighbouring '
                          'officer to lend a worker.',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 26),
              Center(
                child: TextButton.icon(
                  onPressed: session.refreshUser,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Check again'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Palette.inkSecondary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.4,
                color: Palette.inkSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
