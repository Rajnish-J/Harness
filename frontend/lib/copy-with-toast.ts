import { toast } from "@/components/ui/toast";

import { copyText } from "./clipboard";

/**
 * Copy to the clipboard and say so, or say why not.
 *
 * Separate from lib/clipboard.ts on purpose: that file is framework-free, and
 * importing the toast store into it would make every consumer a client module
 * for the sake of one message.
 *
 * The failure text names the actual cause. `navigator.clipboard` is undefined
 * outside a secure context, so a harness reached over a LAN at http://host
 * cannot copy at all -- and "nothing happened" is a much worse answer than
 * "this needs HTTPS".
 */
export async function copyWithToast(value: string, what: string): Promise<void> {
  if (await copyText(value)) {
    toast.success(`${what} copied.`);
    return;
  }
  toast.error({
    title: `Could not copy the ${what.toLowerCase()}`,
    description: "The clipboard is only available over HTTPS or on localhost.",
  });
}
