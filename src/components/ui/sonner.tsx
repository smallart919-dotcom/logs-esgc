import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      offset={16}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "liquid-glass-toast group toast text-foreground !rounded-2xl !p-4 !gap-3",
          title: "font-semibold tracking-tight text-[15px]",
          description: "text-muted-foreground text-[13px]",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "liquid-glass-toast-success",
          error: "liquid-glass-toast-error",
          loading: "liquid-glass-toast-loading",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
