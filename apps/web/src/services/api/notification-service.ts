import { InAppNotification } from '@/types/document';

export class NotificationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = (
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
    ).replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token =
      typeof window !== 'undefined'
        ? (window as any).__DEV_AUTH_TOKEN__ || localStorage.getItem('auth_token')
        : undefined;

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options.headers as any) || {}),
      },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }
    const data = await res.json();
    return data.data;
  }

  async getNotifications(
    isRead?: boolean
  ): Promise<{ items: InAppNotification[]; unreadCount: number }> {
    const q = isRead !== undefined ? `?isRead=${isRead}` : '';
    return this.request<{ items: InAppNotification[]; unreadCount: number }>(
      `/notifications${q}`
    );
  }

  async getUnreadCount(): Promise<number> {
    const res = await this.request<{ unreadCount: number }>(
      '/notifications/unread-count'
    );
    return res.unreadCount;
  }

  async markAsRead(id: string): Promise<any> {
    return this.request(`/notifications/${id}/read`, { method: 'PATCH' });
  }

  async markAllAsRead(): Promise<any> {
    return this.request('/notifications/read-all', { method: 'PATCH' });
  }
}

export const notificationService = new NotificationService();
