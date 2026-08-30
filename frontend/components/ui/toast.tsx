"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { Toast as ToastPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import {
  getServerToastsSnapshot,
  getToastsSnapshot,
  subscribeToasts,
  toast,
  type ToastRecord,
  type ToastType,
} from "@/lib/toast"

/**
 * setTimeout coerces its delay to a 32-bit int, so `Infinity` would round-trip
 * to 0 and dismiss the toast instantly. This is the real "never" value.
 */
const NEVER = 2147483647

const ICONS: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2Icon,
  error: XCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
  loading: Loader2Icon,
}

/**
 * There are no success/warning tokens in globals.css — only the neutral shadcn
 * set — so these mirror the emerald/red/amber pairs the inline banners used
 * before, keeping one palette across both themes.
 */
const TONES: Record<ToastType, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
  loading: "text-muted-foreground",
}

function ToastItem({ record }: { record: ToastRecord }) {
  const type = record.type ?? "info"
  const Icon = ICONS[type]

  return (
    <ToastPrimitive.Root
      data-slot="toast"
      duration={
        record.duration === undefined || record.duration === Infinity
          ? NEVER
          : record.duration
      }
      // Radix owns the dismiss timer (which is what gives us pause-on-hover and
      // swipe); the store just drops the record once it reports closed.
      onOpenChange={(open) => {
        if (!open) toast.close(record.id)
      }}
      className={cn(
        "group pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border bg-popover p-4 pr-8 text-popover-foreground shadow-lg",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full",
        "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none",
        "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform]",
        "data-[swipe=end]:animate-out data-[swipe=end]:slide-out-to-right-full"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          TONES[type],
          type === "loading" && "animate-spin"
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ToastPrimitive.Title
          data-slot="toast-title"
          className="text-sm font-medium"
        >
          {record.title}
        </ToastPrimitive.Title>
        {record.description && (
          <ToastPrimitive.Description
            data-slot="toast-description"
            className="text-sm break-words text-muted-foreground"
          >
            {record.description}
          </ToastPrimitive.Description>
        )}
      </div>

      {record.actionProps && (
        <ToastPrimitive.Action
          data-slot="toast-action"
          // Screen readers get this instead of the button, which they cannot
          // reach quickly while the toast is up.
          altText={
            typeof record.actionProps.children === "string"
              ? record.actionProps.children
              : record.title
          }
          onClick={record.actionProps.onClick}
          className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
        >
          {record.actionProps.children}
        </ToastPrimitive.Action>
      )}

      <ToastPrimitive.Close
        data-slot="toast-close"
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus:opacity-100"
      >
        <XIcon className="size-3.5" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}

/**
 * Mounted once, in the root layout. Reads the module-level store in `lib/toast.ts`
 * so anything in the app can raise a toast without a provider in scope.
 */
function Toaster() {
  const records = React.useSyncExternalStore(
    subscribeToasts,
    getToastsSnapshot,
    getServerToastsSnapshot
  )

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {records.map((record) => (
        <ToastItem key={record.id} record={record} />
      ))}
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className="pointer-events-none fixed right-0 bottom-0 z-100 flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[26rem]"
      />
    </ToastPrimitive.Provider>
  )
}

export { Toaster, toast }
