import { siteMetadata } from "@/lib/i18n/root-document";
import { Login } from "@/features/auth/login";
export default function LoginPage(){return <Login/>;}

export const metadata = siteMetadata("ru", "/login");
