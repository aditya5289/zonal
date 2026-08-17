import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/palette.dart';
import '../../core/session.dart';
import '../../shared/ui.dart';
import 'complaint_detail_screen.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<AppNotification>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<AppNotification>> _load() async {
    final res = await context.read<ApiClient>().get('/notifications');
    return (res['notifications'] as List)
        .map((n) => AppNotification.fromJson(n as Map<String, dynamic>))
        .toList();
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _markAllRead() async {
    try {
      await context.read<ApiClient>().post('/notifications/read-all');
      if (mounted) {
        await context.read<Session>().refreshUnreadCount();
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
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: _markAllRead,
            child: const Text('Mark all read', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: FutureBuilder<List<AppNotification>>(
        future: _future,
        builder: (context, snapshot) => AsyncBody<List<AppNotification>>(
          snapshot: snapshot,
          onRetry: _refresh,
          builder: (items) {
            if (items.isEmpty) {
              return const EmptyState(
                icon: Icons.notifications_none,
                title: 'Nothing yet',
                subtitle: 'Updates about your complaints and tasks land here.',
              );
            }

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, __) => const Divider(height: 1, indent: 60),
                itemBuilder: (_, i) {
                  final n = items[i];
                  return ListTile(
                    onTap: n.complaintId == null
                        ? null
                        : () async {
                            await context
                                .read<ApiClient>()
                                .post('/notifications/${n.id}/read');
                            if (!context.mounted) return;
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    ComplaintDetailScreen(complaintId: n.complaintId!),
                              ),
                            );
                            if (context.mounted) {
                              await context.read<Session>().refreshUnreadCount();
                              await _refresh();
                            }
                          },
                    leading: Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: n.read
                            ? Palette.grid
                            : Palette.inkPrimary.withValues(alpha: 0.06),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        n.read ? Icons.done : Icons.notifications_active,
                        size: 19,
                        color: n.read ? Palette.inkMuted : Palette.inkPrimary,
                      ),
                    ),
                    title: Text(
                      n.title,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: n.read ? FontWeight.w500 : FontWeight.w700,
                      ),
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        n.body,
                        style: const TextStyle(
                            fontSize: 12.5, height: 1.3, color: Palette.inkSecondary),
                      ),
                    ),
                    trailing: Text(
                      timeAgo(n.createdAt),
                      style: const TextStyle(fontSize: 11, color: Palette.inkMuted),
                    ),
                    isThreeLine: true,
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}
