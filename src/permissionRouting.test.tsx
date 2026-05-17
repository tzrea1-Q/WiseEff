import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App, { appReducer } from "./App";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("permission-aware routing", () => {
  it("hides admin and operational navigation for Guest", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    const navigation = within(screen.getByRole("navigation", { name: /主导航|涓诲鑸?/ }));
    expect(navigation.getByRole("button", { name: /参数修改|鍙傛暟淇敼/ })).toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: /参数审阅|鍙傛暟瀹￠槄/ })).not.toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: /参数调试|鍙傛暟璋冭瘯/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /系统设置|绯荤粺璁剧疆/ })).not.toBeInTheDocument();
  });

  it("lets Admin see the shared user permissions utility entry", () => {
    const adminState = { ...initialState, activeRoleId: "admin" };
    expect(adminState.activeRoleId).toBe("admin");
  });

  it("prevents Guest from mutating parameter values in the reducer", () => {
    const next = appReducer(initialState, {
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [{ parameterId: initialState.parameters[0].id, targetValue: "123", reason: "guest attempt" }]
    });

    expect(next).toBe(initialState);
  });
});
