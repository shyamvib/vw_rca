/**
 * CAMs that appear on orders (rfm_orders.cam_id) but have no row in Cube's internal_user, so there is no name or email to match a
 * login to. Key = the CAM id as listed under "unmatched" by /admin/cams (or scripts/cam-logins.mjs). A row in internal_user always
 * wins over an entry here. A .ts file, not JSON, because the Docker image copies engine/*.ts only.
 */
export const CAM_OVERRIDES: Record<string, { name: string; email: string }> = {
  // Akanksha Sharma: CAM on 100% of Sara Simiele's and William Maycock's orders (Suzi Hansen's team).
  "1541": { name: "Akanksha Sharma", email: "akanksha.s@vibrant-wellness.com" },
};
