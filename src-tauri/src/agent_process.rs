//! Own the entire CLI process tree, including native children of npm wrappers.
use std::io;
use std::process::{Child, Command};

#[cfg(windows)]
pub struct ProcessTree(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl ProcessTree {
  pub fn configure(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // Assign the job before the wrapper can create any uncontained children.
    command.creation_flags(0x0800_0000 | 0x0000_0004); // NO_WINDOW | SUSPENDED
  }

  pub fn attach(child: &Child) -> io::Result<Self> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::JobObjects::*;
    // SAFETY: handles remain owned for every call; the information buffer is
    // initialized and its exact size is supplied. No handle is inherited.
    unsafe {
      let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if handle.is_null() { return Err(io::Error::last_os_error()); }
      let job = OwnedHandle::from_raw_handle(handle);
      let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
        &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0
        || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0 {
        return Err(io::Error::last_os_error());
      }
      resume_primary_thread(child.id())?;
      Ok(Self(job))
    }
  }

  pub fn terminate(&self) {
    use std::os::windows::io::AsRawHandle;
    // SAFETY: the job handle is live and owned by self.
    unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1); }
  }
}

#[cfg(windows)]
fn resume_primary_thread(pid: u32) -> io::Result<()> {
  use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
  use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
  use windows_sys::Win32::System::{Diagnostics::ToolHelp::*, Threading::*};
  // std::Child exposes the process handle but not its primary thread. A
  // CREATE_SUSPENDED child has not run user code, so find that thread by PID.
  // SAFETY: snapshot and thread handles are checked then owned by RAII guards;
  // THREADENTRY32 is initialized with the size required by the Windows API.
  unsafe {
    let raw = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if raw == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
    let snapshot = OwnedHandle::from_raw_handle(raw);
    let mut entry: THREADENTRY32 = std::mem::zeroed();
    entry.dwSize = std::mem::size_of_val(&entry) as u32;
    let mut available = Thread32First(snapshot.as_raw_handle(), &mut entry);
    while available != 0 {
      if entry.th32OwnerProcessID == pid {
        let raw_thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
        if raw_thread.is_null() { return Err(io::Error::last_os_error()); }
        let thread = OwnedHandle::from_raw_handle(raw_thread);
        if ResumeThread(thread.as_raw_handle()) == u32::MAX { return Err(io::Error::last_os_error()); }
        return Ok(());
      }
      available = Thread32Next(snapshot.as_raw_handle(), &mut entry);
    }
  }
  Err(io::Error::other("Agent primary thread was not found"))
}

#[cfg(unix)]
pub struct ProcessTree(libc::pid_t);

#[cfg(unix)]
impl ProcessTree {
  pub fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
  }

  pub fn attach(child: &Child) -> io::Result<Self> { Ok(Self(child.id() as libc::pid_t)) }

  pub fn terminate(&self) {
    // SAFETY: this is the private process group created for this child.
    unsafe { libc::kill(-self.0, libc::SIGKILL); }
  }
}
