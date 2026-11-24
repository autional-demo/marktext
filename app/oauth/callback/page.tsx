import { redirect } from "next/navigation";

/** OAuth 跳转已退役；旧链接统一回到内嵌登录页。 */
export default function OAuthCallbackPage() {
  redirect("/login");
}
