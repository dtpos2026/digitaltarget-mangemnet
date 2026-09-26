import { describe, expect, it } from "vitest";
import { classifyChat } from "../chatClassifier";

const them = (text: string) => ({ text, fromMe: false });
const me = (text: string) => ({ text, fromMe: true });

describe("classifyChat", () => {
  it("new inquiry about ads → Digital Marketing, New", () => {
    expect(classifyChat([them("Assalam o alaikum"), them("Facebook ads chalwane hain restaurant ke liye")]))
      .toMatchObject({ line: "Digital Marketing", status: "New" });
  });
  it("asks price after our reply → Interested", () => {
    expect(classifyChat([them("Mujhe POS software chahiye"), me("Ji zaroor"), them("Price kitne ki hai?")]))
      .toMatchObject({ line: "AI Software Development", status: "Interested" });
  });
  it("payment message → Converted", () => {
    expect(classifyChat([them("Logo design karwana hai"), me("15k"), them("Theek hai advance bhej diya hai")]).status).toBe("Converted");
  });
  it("later / baad mein → Follow-up; not interested → Lost", () => {
    expect(classifyChat([them("reels editing ka rate?"), me("2500 per reel"), them("theek hai baad mein batata hun")]).status).toBe("Follow-up");
    expect(classifyChat([them("website ka rate?"), me("60k"), them("abhi zarurat nahi, not interested")]).status).toBe("Lost");
  });
  it("social media page management", () => {
    expect(classifyChat([them("Hamara instagram page manage kar denge? posting aur content")]).line).toBe("Social Media Management");
  });
  it("our own reply alone → Contacted; empty chat → New with no line", () => {
    expect(classifyChat([them("hi"), me("Salam, kaise madad karein?")])).toMatchObject({ status: "Contacted", line: null });
    expect(classifyChat([])).toMatchObject({ status: "New", line: null });
  });
});
