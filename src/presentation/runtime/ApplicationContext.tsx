import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AppDatabase } from "@/infrastructure/persistence";
import type { ApplicationRuntime } from "@/app/bootstrap";
import {
  createRuntimeServices,
  type RuntimeServiceError,
  type RuntimeServices,
} from "@/app/runtime-services";

interface ApplicationContextValue {
  readonly runtime: ApplicationRuntime;
  readonly database: AppDatabase;
  readonly services: RuntimeServices | null;
  readonly serviceError: RuntimeServiceError | null;
  readonly refreshServices: () => void;
}

const ApplicationContext = createContext<ApplicationContextValue | null>(null);

export function ApplicationProvider({
  runtime,
  children,
}: {
  readonly runtime: ApplicationRuntime;
  readonly children: ReactNode;
}) {
  const database = useSyncExternalStore(
    runtime.session.subscribe.bind(runtime.session),
    runtime.session.snapshot.bind(runtime.session),
  );
  const buildServices = useCallback(() => createRuntimeServices(runtime), [runtime]);
  const [serviceResult, setServiceResult] = useState(buildServices);
  const refreshServices = useCallback(() => setServiceResult(buildServices()), [buildServices]);
  const value = useMemo<ApplicationContextValue>(
    () => ({
      runtime,
      database,
      services: serviceResult.ok ? serviceResult.value : null,
      serviceError: serviceResult.ok ? null : serviceResult.error,
      refreshServices,
    }),
    [database, refreshServices, runtime, serviceResult],
  );
  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): ApplicationContextValue {
  const value = useContext(ApplicationContext);
  if (!value) throw new Error("useApplication must be used inside ApplicationProvider");
  return value;
}
