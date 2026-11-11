/// <reference path="../pb_data/types.d.ts" />
// TEN-15 / D53: logged-not-sent stand-in for the staff OTP email (second MFA factor).
// GO-LIVE P12 (SES) replaces this hook with real delivery. The handler never continues the
// hook chain, so PocketBase never sends the mail. The code itself is logged only in dev/test, when the
// stand-in env gate below is "1"; otherwise the line says "(code hidden)".
onMailerRecordOTPSend((e) => {
  const collection = e.record.collection().name;
  const recordId = e.record.id;
  const otpId = e.meta.otpId;
  if ($os.getenv("CDS_OTP_STANDIN") === "1") {
    console.log(
      `OTP_STANDIN ${collection} ${recordId} ${otpId} ${e.meta.password}`,
    );
  } else {
    console.log(`OTP_STANDIN ${collection} ${recordId} ${otpId} (code hidden)`);
  }
  // Temporary real delivery (Titan SMTP, until SES): PocketBase sends through its own SMTP
  // settings (Settings -> Mail) when CDS_OTP_SEND is "1".
  if ($os.getenv("CDS_OTP_SEND") === "1") e.next();
});
