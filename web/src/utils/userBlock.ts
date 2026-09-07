import { ElMessage, ElMessageBox } from "element-plus";
import { request } from "@/api/request";
import { clearCommunityViewCaches } from "./privacyLocalState";

export async function blockUser(targetType: "user" | "topic" | "reply" | "conversation", targetId: number) {
  try {
    await ElMessageBox.confirm("屏蔽后，你将不再看到该账号的帖子和回复，双方也不能继续私聊。匿名身份同样生效。可在“我的 → 账号与隐私”解除。", "屏蔽用户", { confirmButtonText: "确认屏蔽", cancelButtonText: "取消", type: "warning" });
  } catch { return false; }
  await request.post("/user/blocks", { targetType, targetId });
  clearCommunityViewCaches();
  ElMessage.success("已屏蔽该用户");
  window.location.replace('/profile/privacy');
  return true;
}
