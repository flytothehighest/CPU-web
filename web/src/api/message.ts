import { request, type RequestOptions } from "./request";
import { useAuthStore } from "@/stores/auth";
import { visibleNativeNotices } from "@/utils/nativeForumVisibility";

export const messageApi = {
  list: async (category?: string, options?: RequestOptions) => {
    const notices = await request.get<any[]>("/messages", category ? { category } : {}, options);
    return visibleNativeNotices(notices, useAuthStore().forumHidden);
  },
  read: (id: number, options?: RequestOptions) => request.post<any>(`/messages/${id}/read`, undefined, options),
  readAll: (options?: RequestOptions) => request.post<any>("/messages/read-all", undefined, options),
  settings: (options?: RequestOptions) => request.get<any>("/messages/settings", undefined, options),
  updateSettings: (payload: Record<string, unknown>, options?: RequestOptions) => request.patch<any>("/messages/settings", payload, options),
};
