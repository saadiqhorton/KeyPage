export type HealthResponse = {
  status: "ok";
  app: string;
  version: string;
  dataDir: string;
  firstBootAt: string;
};
