import { RouterProvider } from "react-router-dom";

import { router } from "@/routes/router";
import { VaultProvider } from "@/vault/VaultProvider";

export default function App() {
  return (
    <VaultProvider>
      <RouterProvider router={router} />
    </VaultProvider>
  );
}
