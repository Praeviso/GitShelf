import { useState, useCallback, lazy, Suspense } from 'preact/compat';
import { useRouter } from '../hooks/useRouter';
import { useTheme } from '../hooks/useTheme';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ScrollToTop } from './ScrollToTop';
import { ToastContainer } from './ToastContainer';
import { BookshelfView } from './BookshelfView';
import { ReaderView } from './ReaderView';
import { Footer } from './Footer';

const AdminView = lazy(() => import('./AdminView'));

export function App() {
  const route = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tocData, setTocData] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState('');

  const isChapter = route.type === 'chapter';
  const isReaderRoute = route.type === 'book' || route.type === 'chapter';
  const { progress, showScrollTop, scrollToTop } = useScrollProgress(isChapter);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleTocLoaded = useCallback((data) => {
    setTocData(data);
    setBreadcrumb(data?.title || '');
  }, []);

  const showSidebar = isReaderRoute;

  return (
    <>
      <a href="#main-content" class="skip-link">Skip to content</a>

      <TopBar
        theme={theme}
        onToggleTheme={toggleTheme}
        breadcrumb={breadcrumb}
        showBookshelfLink={route.type !== 'bookshelf'}
        showSidebarToggle={showSidebar}
        onToggleSidebar={handleToggleSidebar}
        sidebarExpanded={sidebarOpen}
        progress={progress}
        showProgress={isChapter}
      />

      {showSidebar && (
        <Sidebar
          tocData={tocData}
          bookId={route.bookId}
          activeSlug={route.slug}
          open={sidebarOpen}
          onClose={handleCloseSidebar}
        />
      )}

      <main id="main-content" class={`main-content${showSidebar ? ' with-sidebar' : ''}`}>
        {route.type === 'bookshelf' && <BookshelfView />}
        {isReaderRoute && (
          <ReaderView
            key={route.bookId + (route.slug || '')}
            bookId={route.bookId}
            slug={route.slug}
            anchor={route.anchor}
            onTocLoaded={handleTocLoaded}
          />
        )}
        {route.type === 'admin' && (
          <Suspense fallback={<div class="admin-container"><p>Loading admin panel...</p></div>}>
            <AdminView />
          </Suspense>
        )}
      </main>

      <Footer />
      <ScrollToTop visible={showScrollTop} onClick={scrollToTop} />
      <ToastContainer />
    </>
  );
}
