"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./app-shell.module.css";

const navigation = [
  { href: "/candidates", label: "Candidates" },
  { href: "/reports", label: "Reports" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const jobMenu = useRef<HTMLDetailsElement>(null);
  const closeNavigation = () => { setMenuOpen(false); jobMenu.current?.removeAttribute("open"); };

  useEffect(() => {
    jobMenu.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      if (jobMenu.current && !jobMenu.current.contains(event.target as Node)) jobMenu.current.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { jobMenu.current?.removeAttribute("open"); setMenuOpen(false); }
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsideInteraction); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  if (pathname.startsWith("/apply/")) return <>{children}</>;
  return (
    <div className={styles.appShell}>
      <header className={styles.topbar}>
        <Link href="/jobs" className={styles.brand} aria-label="InnoHire home">
          <span className={styles.brandMark}><span /></span><span>INNOHIRE</span>
        </Link>
        <button type="button" className={styles.menuButton} aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button>
        <nav className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`} aria-label="Primary navigation">
          <details ref={jobMenu} className={styles.dropdown}>
            <summary className={pathname.startsWith("/jobs") ? styles.navLinkActive : styles.navLink}>Job Board</summary>
            <div className={styles.dropdownMenu}>
              <Link href="/jobs" onClick={closeNavigation} className={pathname === "/jobs" ? styles.dropdownLinkActive : styles.dropdownLink}><span>▤</span><div><strong>All jobs</strong><small>View and manage roles</small></div></Link>
              <Link href="/jobs/new" onClick={closeNavigation} className={pathname.startsWith("/jobs/new") ? styles.dropdownLinkActive : styles.dropdownLink}><span>＋</span><div><strong>Post a job</strong><small>Create and publish a role</small></div></Link>
            </div>
          </details>
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} onClick={closeNavigation} className={active ? styles.navLinkActive : styles.navLink}>{item.label}</Link>;
          })}
        </nav>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" aria-label="Notifications"><span className={styles.notificationDot} /><span aria-hidden="true">●</span></button>
          <div className={styles.profile} aria-label="HR profile">HR</div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
