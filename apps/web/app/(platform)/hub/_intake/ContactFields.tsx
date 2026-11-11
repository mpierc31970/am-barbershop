"use client";
// "Contact & hours" fields (06-19; 06-UI-SPEC "2 · Contact & hours"; ONB-01, ONB-13, D257).
// Reused by setup step 2 and Settings (06-22): the host passes the profile, readOnly and
// onSave(patch). Groups:
//   - How customers reach you: Phone + Public email. At least one is required, so clearing
//     the last one is refused here ("Add a phone number or an email…") and not saved.
//   - Where you are: address parts (optional; saved together), service area (optional),
//     Time zone (required). An empty time zone is filled from the browser
//     (browserTimeZone(), after mount so server and client render the same) and saved once.
//   - Social links: rows of platform + URL, Add a social link, a named remove button. A row
//     without a URL stays on screen but isn't saved yet.
// Hours are their own section (HoursSection, passed in as `hours`) because they save
// debounced as one value; they render between "Where you are" and "Social links".
import {
  SOCIAL_PLATFORMS,
  type Address,
  type SocialLink,
  type SocialPlatform,
} from "@cds/core/intake";
import { browserTimeZone } from "@cds/ui/builder";
import { Button, IconButton, Select, TextField } from "@cds/ui/hub";
import type { BusinessProfile } from "@cds/core/intake";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStageInvalid } from "../setup/[stage]/StageFrame";
import { FieldGroup } from "./FieldGroup";
import { OPTIONAL } from "./BusinessInfoFields";
import { useProfileField, type ProfileSave } from "./useProfileField";

export const CONTACT_GROUP_HELPER =
  "Add at least one: a phone number or an email.";
export const CONTACT_MISSING_COPY =
  "Add a phone number or an email so customers can reach you.";
export const TIME_ZONE_HELPER =
  "Detected from your device. Change it if your business is elsewhere.";

export const PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  pinterest: "Pinterest",
  threads: "Threads",
  yelp: "Yelp",
  nextdoor: "Nextdoor",
  other: "Other",
};

const PLATFORM_OPTIONS = SOCIAL_PLATFORMS.map((p) => ({
  value: p,
  label: PLATFORM_LABELS[p],
}));

/** US zones first, then a few common elsewhere; the current value is always listed. */
const ZONES: readonly [string, string][] = [
  ["America/New_York", "Eastern time"],
  ["America/Chicago", "Central time"],
  ["America/Denver", "Mountain time"],
  ["America/Phoenix", "Arizona time"],
  ["America/Los_Angeles", "Pacific time"],
  ["America/Anchorage", "Alaska time"],
  ["Pacific/Honolulu", "Hawaii time"],
  ["America/Puerto_Rico", "Atlantic time (Puerto Rico)"],
  ["America/Toronto", "Toronto"],
  ["America/Vancouver", "Vancouver"],
  ["America/Mexico_City", "Mexico City"],
  ["Europe/London", "London"],
  ["Europe/Dublin", "Dublin"],
  ["Europe/Paris", "Paris"],
  ["Europe/Berlin", "Berlin"],
  ["Australia/Sydney", "Sydney"],
  ["Pacific/Auckland", "Auckland"],
];

export function timeZoneOptions(current: string) {
  const list = ZONES.map(([value, label]) => ({
    value,
    label: `${label} (${value})`,
  }));
  if (current && !ZONES.some(([z]) => z === current)) {
    list.unshift({ value: current, label: current });
  }
  return [{ value: "", label: "Choose one" }, ...list];
}

type Row = { key: number; platform: SocialPlatform; url: string };

export interface ContactFieldsProps {
  profile: BusinessProfile;
  readOnly: boolean;
  onSave: ProfileSave;
  /** Live time zone, for the hours editor's "Times are in …" line. */
  onTimeZoneChange?: (tz: string) => void;
  /** Rendered between "Where you are" and "Social links" (the hours section). */
  hours?: ReactNode;
}

export function ContactFields({
  profile,
  readOnly,
  onSave,
  onTimeZoneChange,
  hours,
}: ContactFieldsProps) {
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.public_email);
  const [reachError, setReachError] = useState<string | null>(null);
  const [address, setAddress] = useState<Address>(profile.address);
  const [area, setArea] = useState(profile.service_area);
  const [zone, setZone] = useState(profile.time_zone);
  const nextKey = useRef(profile.socials.length);
  const [rows, setRows] = useState<Row[]>(() =>
    profile.socials.map((s, i) => ({ key: i, ...s })),
  );

  const savePhone = useProfileField("phone", profile.phone, onSave);
  const saveEmail = useProfileField(
    "public_email",
    profile.public_email,
    onSave,
  );
  const saveAddress = useProfileField("address", profile.address, onSave);
  const saveArea = useProfileField(
    "service_area",
    profile.service_area,
    onSave,
  );
  const saveZone = useProfileField("time_zone", profile.time_zone, onSave);
  const saveSocials = useProfileField("socials", profile.socials, onSave);
  useStageInvalid("local.reach", reachError !== null);

  // Prefill an empty time zone from the device once (after mount: no hydration mismatch).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || profile.time_zone || readOnly) return;
    prefilled.current = true;
    const tz = browserTimeZone();
    if (!tz) return;
    setZone(tz);
    onTimeZoneChange?.(tz);
    saveZone.save(tz);
  }, [profile.time_zone, readOnly, onTimeZoneChange, saveZone]);

  // Once the pair is valid again, both go out: a clear refused earlier (phone emptied while
  // the email was empty) is sent now, and the de-dup skips the unchanged one (C-WR-02).
  function saveReach() {
    const p = phone.trim();
    const e = email.trim();
    if (p === "" && e === "") {
      setReachError(CONTACT_MISSING_COPY);
      return;
    }
    setReachError(null);
    savePhone.save(p);
    saveEmail.save(e);
  }

  function saveRows(next: Row[]) {
    const links: SocialLink[] = next
      .filter((r) => r.url.trim() !== "")
      .map((r) => ({ platform: r.platform, url: r.url.trim() }));
    saveSocials.save(links);
  }

  function setAddressPart(part: keyof Address, v: string) {
    setAddress((a) => ({ ...a, [part]: v }));
  }
  const saveAddressNow = () =>
    saveAddress.save({
      street: address.street.trim(),
      city: address.city.trim(),
      state: address.state.trim(),
      zip: address.zip.trim(),
    });

  return (
    <>
      <FieldGroup id="group-reach" title="How customers reach you">
        <div
          role="group"
          aria-labelledby="group-reach"
          aria-describedby="reach-helper"
          className="flex flex-col gap-4"
        >
          <TextField
            id="field-phone"
            label="Phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={phone}
            disabled={readOnly}
            error={savePhone.error}
            onChange={(e) => {
              setPhone(e.target.value);
              if (reachError && e.target.value.trim()) setReachError(null);
            }}
            onBlur={saveReach}
          />
          <TextField
            id="field-public_email"
            label="Public email"
            type="email"
            autoComplete="email"
            helper="Shown on your site. It can differ from your sign-in email."
            value={email}
            disabled={readOnly}
            error={saveEmail.error}
            onChange={(e) => {
              setEmail(e.target.value);
              if (reachError && e.target.value.trim()) setReachError(null);
            }}
            onBlur={saveReach}
          />
          <p
            id="reach-helper"
            className={`text-sm ${reachError ? "text-hub-danger" : "text-hub-ink-muted"}`}
            role={reachError ? "alert" : undefined}
          >
            {reachError ?? CONTACT_GROUP_HELPER}
          </p>
        </div>
      </FieldGroup>

      <FieldGroup id="group-where" title="Where you are">
        <div
          id="field-address"
          tabIndex={-1}
          className="flex flex-col gap-4 outline-none"
        >
          <TextField
            id="field-address-street"
            label="Street address"
            labelExtra={OPTIONAL}
            helper="Leave empty if you don't see customers in person."
            autoComplete="street-address"
            maxLength={120}
            value={address.street}
            disabled={readOnly}
            error={saveAddress.error}
            onChange={(e) => setAddressPart("street", e.target.value)}
            onBlur={saveAddressNow}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              id="field-address-city"
              label="City"
              autoComplete="address-level2"
              maxLength={80}
              value={address.city}
              disabled={readOnly}
              onChange={(e) => setAddressPart("city", e.target.value)}
              onBlur={saveAddressNow}
            />
            <TextField
              id="field-address-state"
              label="State"
              autoComplete="address-level1"
              maxLength={60}
              value={address.state}
              disabled={readOnly}
              onChange={(e) => setAddressPart("state", e.target.value)}
              onBlur={saveAddressNow}
            />
            <TextField
              id="field-address-zip"
              label="ZIP"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={20}
              value={address.zip}
              disabled={readOnly}
              onChange={(e) => setAddressPart("zip", e.target.value)}
              onBlur={saveAddressNow}
            />
          </div>
        </div>
        <TextField
          id="field-service_area"
          label="Service area"
          labelExtra={OPTIONAL}
          helper="Like 'Austin and Round Rock' or 'Online, anywhere'."
          maxLength={120}
          value={area}
          disabled={readOnly}
          error={saveArea.error}
          onChange={(e) => setArea(e.target.value)}
          onBlur={() => saveArea.save(area.trim())}
        />
        <Select
          id="field-time_zone"
          label="Time zone"
          helper={TIME_ZONE_HELPER}
          required
          options={timeZoneOptions(zone)}
          value={zone}
          disabled={readOnly}
          error={saveZone.error}
          onChange={(e) => {
            setZone(e.target.value);
            onTimeZoneChange?.(e.target.value);
            if (e.target.value) saveZone.save(e.target.value);
          }}
        />
      </FieldGroup>

      {hours}

      <FieldGroup id="group-social" title="Social links" titleExtra={OPTIONAL}>
        <div
          id="field-socials"
          tabIndex={-1}
          className="flex flex-col gap-4 outline-none"
        >
          {rows.length === 0 ? (
            <p className="text-sm text-hub-ink-muted">
              Leave empty and your site shows no social links.
            </p>
          ) : null}
          {rows.map((r, i) => {
            const label = PLATFORM_LABELS[r.platform];
            return (
              <div
                key={r.key}
                className="grid items-end gap-2 md:grid-cols-[180px_1fr_auto]"
              >
                <Select
                  id={`social-${r.key}-platform`}
                  label="Platform"
                  options={PLATFORM_OPTIONS}
                  value={r.platform}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = rows.map((x, j) =>
                      j === i
                        ? { ...x, platform: e.target.value as SocialPlatform }
                        : x,
                    );
                    setRows(next);
                    saveRows(next);
                  }}
                />
                <TextField
                  id={`social-${r.key}-url`}
                  label={`${label} link`}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  maxLength={300}
                  value={r.url}
                  disabled={readOnly}
                  onChange={(e) =>
                    setRows(
                      rows.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    )
                  }
                  onBlur={() => saveRows(rows)}
                />
                {readOnly ? null : (
                  <IconButton
                    label={`Remove ${label} link`}
                    icon={<X aria-hidden size={16} strokeWidth={2} />}
                    onClick={() => {
                      const next = rows.filter((_, j) => j !== i);
                      setRows(next);
                      saveRows(next);
                    }}
                  />
                )}
              </div>
            );
          })}
          {saveSocials.error ? (
            <p className="text-sm text-hub-danger">{saveSocials.error}</p>
          ) : null}
          {readOnly || rows.length >= 10 ? null : (
            <div>
              <Button
                variant="ghost"
                icon={<Plus aria-hidden size={16} strokeWidth={2} />}
                onClick={() => {
                  const used = new Set(rows.map((r) => r.platform));
                  const platform =
                    SOCIAL_PLATFORMS.find((p) => !used.has(p)) ?? "other";
                  setRows([
                    ...rows,
                    { key: nextKey.current++, platform, url: "" },
                  ]);
                }}
              >
                Add a social link
              </Button>
            </div>
          )}
        </div>
      </FieldGroup>
    </>
  );
}
