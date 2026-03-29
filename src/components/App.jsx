import { useState, useEffect, useCallback, lazy, Suspense } from 'preact/compat';
import { useRouter } from '../hooks/useRouter';
import { useTheme } from '../hooks/useTheme';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ScrollToTop } from './ScrollToTop';
import { ToastContainer } from './ToastContainer';
import { HomeView } from './HomeView';
import { ChapterReader } from './ChapterReader';
import { BookOverview } from './BookOverview';
import { ArticleReader } from './ArticleReader';
import { Footer } from './Footer';
import { fetchManifest } from '../lib/api';

const AdminView = lazy(() => import('./AdminView'));

export function App() {
  const route = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tocData, setTocData] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState('');

  const isChapter = route.type === 'chapter';
  const isBookRoute = route.type === 'book-overview' || route.type === 'chapter';
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

  // Handle site redirect
  useEffect(() => {
    if (route.type === 'site') {
      fetchManifest().then((manifest) => {
        const item = manifest.items?.find((i) => i.id === route.siteId);
        if (item?.entry) {
          window.open(`./${item.entry}`, '_blank');
        }
        location.hash = '#/';
      });
    }
  }, [route.type, route.siteId]);

  // Reset sidebar state when leaving book routes
  useEffect(() => {
    if (!isBookRoute) {
      setTocData(null);
      setBreadcrumb('');
      setSidebarOpen(false);
    }
  }, [isBookRoute]);

  const showSidebar = isBookRoute;

  return (
    <>
      <a href="#main-content" class="skip-link">Skip to content</a>

      <TopBar
        theme={theme}
        onToggleTheme={toggleTheme}
        breadcrumb={breadcrumb}
        showHomeLink={route.type !== 'home'}
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
        {route.type === 'home' && <HomeView />}
        {route.type === 'book-overview' && (
          <BookOverview
            key={route.bookId}
            bookId={route.bookId}
            onTocLoaded={handleTocLoaded}
          />
        )}
        {route.type === 'chapter' && (
          <ChapterReader
            key={route.bookId + route.slug}
            bookId={route.bookId}
            slug={route.slug}
            anchor={route.anchor}
            onTocLoaded={handleTocLoaded}
          />
        )}
        {route.type === 'article' && (
          <ArticleReader key={route.articleId + (route.anchor || '')} articleId={route.articleId} anchor={route.anchor} />
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
