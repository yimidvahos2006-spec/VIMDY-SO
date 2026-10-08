import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://upoztxlcudrqhnjwjgho.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zUHiDR00FbET1qisM11DCw_iWJ82nDT";

const TEST_EMAIL = "test.e2e.run@vimdy.dev";
const TEST_PASSWORD = "Test123456!";

async function main() {
  if (!SERVICE_ROLE_KEY) {
    console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required.");
    console.error("Get it from Supabase Dashboard → Project Settings → API → service_role key.");
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  console.log("1. Creating test user with email confirmation...");
  console.log("   Email:", TEST_EMAIL);

  let userId: string;
  let userExists = false;

  // Check if user already exists
  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    console.error("Error listing users:", listError.message);
    process.exit(1);
  }

  const existing = existingUsers.users?.find((u) => u.email === TEST_EMAIL);

  if (existing) {
    userId = existing.id;
    userExists = true;
    console.log("   User already exists:", userId);
    console.log("   Email confirmed:", existing.email_confirmed_at ? "yes" : "no");

    // Ensure email is confirmed
    if (!existing.email_confirmed_at) {
      await admin.auth.admin.updateUser(existing.id, {
        email_confirm: true,
        email_confirmed_at: new Date().toISOString()
      });
      console.log("   Email confirmed (forced)");
    }

    // Ensure password is set
    await admin.auth.admin.updateUser(existing.id, {
      password: TEST_PASSWORD
    });
    console.log("   Password updated");
  } else {
    // Create new user with email confirmed
    const { data: signUpData, error: signUpError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      email_confirmed_at: new Date().toISOString(),
      user_metadata: { name: "E2E Test User" }
    });

    if (signUpError || !signUpData.user) {
      console.error("Error creating user:", signUpError?.message);
      process.exit(1);
    }

    userId = signUpData.user.id;
    console.log("   User created:", userId);
  }

  // 2) Sign in to get JWT
  console.log("\n2. Getting JWT...");
  const { data: sessionData, error: sessionError } = await admin.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });

  if (sessionError || !sessionData?.session?.access_token) {
    console.error("Error getting JWT:", sessionError?.message);
    process.exit(1);
  }

  const jwt = sessionData.session.access_token;
  console.log("   JWT obtained:", jwt.slice(0, 30) + "...");

  // 3) Direct seed via admin API (replicates test-seed-environment for "restaurante")
  console.log("\n3. Seeding test business environment...");

  const businessName = `TEST Restaurante E2E`;
  const branchName = "Sucursal principal E2E";

  // Create business
  const { data: business, error: bizError } = await admin
    .from("businesses")
    .upsert({
      name: businessName,
      plan: "trial",
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      country: "CO",
      currency: "COP",
      language: "es",
      timezone: "America/Bogota",
      tax_rate: 19,
      onboarding_completed: true,
      business_type: "restaurante",
      enabled_modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
      salida_cocina: "pantalla"
    }, { onConflict: "name" })
    .select("id")
    .single();

  if (bizError || !business) {
    console.error("Error creating business:", bizError?.message);
    process.exit(1);
  }

  const businessId = business.id;
  console.log("   Business created:", businessId);

  // Create membership
  const { error: memberError } = await admin.from("business_members").upsert({
    user_id: userId,
    business_id: businessId,
    role: "ADMIN"
  }, { onConflict: "user_id,business_id" });

  if (memberError) {
    console.error("Error creating membership:", memberError.message);
  } else {
    console.log("   Membership created");
  }

  // Create profile
  const { error: profileError } = await admin.from("app_users").upsert({
    id: userId,
    business_id: businessId,
    data: {
      id: userId,
      name: "E2E Test User",
      email: TEST_EMAIL,
      roleId: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }, { onConflict: "id" });

  if (profileError) {
    console.error("Error creating profile:", profileError.message);
  } else {
    console.log("   Profile created");
  }

  // Create branch
  const { data: branch, error: branchError } = await admin
    .from("branches")
    .upsert({
      business_id: businessId,
      name: branchName,
      is_main: true,
      active: true
    }, { onConflict: "business_id" })
    .select("id")
    .single();

  if (branchError || !branch) {
    console.error("Error creating branch:", branchError?.message);
    process.exit(1);
  }

  const branchId = branch.id;
  console.log("   Branch created:", branchId);

  // Create waiters
  const waiterId = `waiter_${businessId}_e2e`;
  const { error: waiterError } = await admin.from("waiters").upsert({
    id: waiterId,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: waiterId,
      name: "Mesero TEST E2E",
      active: true,
      businessId,
      branchId
    }
  }, { onConflict: "id" });

  if (waiterError) {
    console.log("   Waiter error:", waiterError.message);
  } else {
    console.log("   Waiter created");
  }

  // Create tables
  const tableRows = Array.from({ length: 4 }).map((_, idx) => ({
    id: `table_${businessId}_${idx}_e2e`,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: `table_${businessId}_${idx}_e2e`,
      name: `Mesa ${idx + 1}`,
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      waiterId: null,
      customerId: null,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      notes: null,
      zone: "Salón",
      mergedInto: null,
      openedAt: null,
      openOperationId: null,
      orderId: null,
      businessId,
      branchId
    }
  }));

  const { error: tableError } = await admin.from("tables").upsert(tableRows, { onConflict: "id" });
  if (tableError) {
    console.log("   Tables error:", tableError.message);
  } else {
    console.log("   Tables created (4)");
  }

  // Create categories
  const categories = ["Entradas", "Platos Fuertes", "Bebidas", "Postres"];
  const catRows = categories.map((name, idx) => ({
    id: `cat_${businessId}_${idx}_e2e`,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: `cat_${businessId}_${idx}_e2e`,
      name,
      businessId,
      branchId
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const { error: catError } = await admin.from("categories").upsert(catRows, { onConflict: "id" });
  if (catError) {
    console.log("   Categories error:", catError.message);
  } else {
    console.log("   Categories created (4)");
  }

  // Create products
  const products = [
    { name: "Hamburguesa TEST", price: 18000, stock: 50 },
    { name: "Papas Fritas TEST", price: 8000, stock: 100 },
    { name: "Gaseosa TEST", price: 4000, stock: 120 }
  ];

  const prodRows = products.map((p, idx) => ({
    id: `prod_${businessId}_${idx}_e2e`,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: `prod_${businessId}_${idx}_e2e`,
      name: p.name,
      price: p.price,
      stock: p.stock,
      businessId,
      branchId,
      active: true
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const { error: prodError } = await admin.from("products").upsert(prodRows, { onConflict: "id" });
  if (prodError) {
    console.log("   Products error:", prodError.message);
  } else {
    console.log("   Products created (3)");
  }

  // Create open cash shift
  const shiftId = `shift_${businessId}_e2e`;
  const { error: shiftError } = await admin.from("shifts").upsert({
    id: shiftId,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: shiftId,
      status: "OPEN",
      openingAmount: 100000,
      openingAt: new Date().toISOString(),
      cashierId: userId,
      businessId,
      branchId
    }
  }, { onConflict: "id" });

  if (shiftError) {
    console.log("   Shift error:", shiftError.message);
  } else {
    console.log("   Cash shift created (OPEN)");
  }

  // Create a test sale
  const saleId = `sale_${businessId}_e2e`;
  const total = 26000;
  const { error: saleError } = await admin.from("sales").upsert({
    id: saleId,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: saleId,
      businessId,
      branchId,
      cashierId: userId,
      customerId: null,
      items: [
        { productId: `prod_${businessId}_0_e2e`, name: "Hamburguesa TEST", quantity: 1, price: 18000 },
        { productId: `prod_${businessId}_1_e2e`, name: "Gaseosa TEST", quantity: 1, price: 8000 }
      ],
      total,
      status: "PAID",
      paymentMethod: "CASH",
      saleDate: new Date().toISOString()
    }
  }, { onConflict: "id" });

  if (saleError) {
    console.log("   Sale error:", saleError.message);
  } else {
    console.log("   Sale created (total:", total + ")");
  }

  // Create cash movement
  const cashId = `cash_${saleId}_e2e`;
  const { error: cashError } = await admin.from("cash_movements").upsert({
    id: cashId,
    business_id: businessId,
    branch_id: branchId,
    version: 1,
    data: {
      id: cashId,
      businessId,
      branchId,
      type: "INCOME",
      amount: total,
      concept: "Venta TEST E2E",
      reference: saleId,
      userId,
      createdAt: new Date().toISOString()
    }
  }, { onConflict: "id" });

  if (cashError) {
    console.log("   Cash movement error:", cashError.message);
  } else {
    console.log("   Cash movement created");
  }

  console.log("\n=== E2E Test Account Ready ===");
  console.log(`Email:    ${TEST_EMAIL}`);
  console.log(`Password: ${TEST_PASSWORD}`);
  console.log(`Business: ${businessName}`);
  console.log(`Business ID: ${businessId}`);
  console.log(`Branch ID: ${branchId}`);
  console.log(`User ID: ${userId}`);
  console.log("\nRun E2E tests with:");
  console.log("  npx playwright test tests/e2e/mobile/mobile-layout-authed.spec.ts");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
