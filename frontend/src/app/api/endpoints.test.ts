import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/mocks/server";
import { registerUser } from "./endpoints";

const user = {
  name: "Alex",
  last_name: "Morgan",
  username: "alexmorgan",
  email: "alex@example.com",
  password: "Password123",
};

describe("registerUser", () => {
  it("posts the typed registration DTO without confirmation or auth headers", async () => {
    let requestBody = "";
    let authorization: string | null = null;
    server.use(http.post("/api/v1/users/", async ({ request }) => {
      requestBody = await request.text();
      authorization = request.headers.get("authorization");
      return HttpResponse.json({ ...user, id: 1 }, { status: 201 });
    }));

    await registerUser(user);

    expect(JSON.parse(requestBody)).toEqual(user);
    expect(requestBody).not.toContain("confirmPassword");
    expect(authorization).toBeNull();
  });
});
