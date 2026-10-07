import { siteMetadata } from "@/lib/i18n/root-document";
import { Account } from "@/features/account/account";
export default function AccountPage(){return <Account/>;}

export const metadata = siteMetadata("ru", "/account");
