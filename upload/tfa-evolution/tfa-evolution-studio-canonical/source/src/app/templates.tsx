import { View, Text, ScrollView, Pressable, FlatList } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Zap, TestTube, RefreshCw, Shield, Gauge, Layout, BookOpen, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

interface Template {
  id: string;
  title: string;
  objective: string;
  category: string;
  tags: string[];
}

const TEMPLATES: { category: string; icon: React.ReactNode; color: string; items: Template[] }[] = [
  {
    category: 'Testing',
    color: C.green,
    icon: <TestTube size={14} color={C.green} />,
    items: [
      { id: 't1', category: 'Testing', tags: ['unit', 'jest'], title: 'Add unit test coverage', objective: 'Add comprehensive unit test coverage using Jest. Target at least 80% line coverage for all business logic, utility functions, and API handlers. Include edge cases and error scenarios.' },
      { id: 't2', category: 'Testing', tags: ['integration', 'e2e'], title: 'Add integration tests', objective: 'Add integration tests covering critical user flows and API endpoint interactions. Ensure database operations, authentication flows, and key business workflows are fully tested.' },
      { id: 't3', category: 'Testing', tags: ['e2e', 'playwright'], title: 'E2E test suite', objective: 'Add end-to-end tests using Playwright or Cypress for the main user journeys. Cover signup, login, core features, and error states.' },
    ],
  },
  {
    category: 'Refactoring',
    color: C.cyan,
    icon: <RefreshCw size={14} color={C.cyan} />,
    items: [
      { id: 'r1', category: 'Refactoring', tags: ['typescript', 'types'], title: 'Migrate to TypeScript', objective: 'Migrate the codebase to TypeScript with strict mode enabled. Add proper type definitions for all functions, components, API responses, and data models. Eliminate any `any` types.' },
      { id: 'r2', category: 'Refactoring', tags: ['architecture', 'repository'], title: 'Repository pattern', objective: 'Refactor the data access layer to use the Repository pattern. Abstract database queries behind interfaces, enabling better testing and future database migrations.' },
      { id: 'r3', category: 'Refactoring', tags: ['clean', 'solid'], title: 'Apply SOLID principles', objective: 'Refactor the codebase to properly apply SOLID principles. Extract large classes, separate concerns, invert dependencies, and ensure each module has a single responsibility.' },
    ],
  },
  {
    category: 'Security',
    color: C.red,
    icon: <Shield size={14} color={C.red} />,
    items: [
      { id: 's1', category: 'Security', tags: ['auth', 'jwt'], title: 'Add JWT authentication', objective: 'Implement JWT-based authentication with refresh tokens. Add protected routes, token validation middleware, secure token storage, and proper logout flow.' },
      { id: 's2', category: 'Security', tags: ['validation', 'sanitization'], title: 'Input validation & sanitization', objective: 'Add comprehensive input validation and sanitization for all API endpoints and form inputs. Protect against SQL injection, XSS, and CSRF. Add rate limiting.' },
      { id: 's3', category: 'Security', tags: ['audit', 'logging'], title: 'Security audit & hardening', objective: 'Perform a full security audit. Fix exposed secrets, add security headers, implement HTTPS enforcement, secure cookie configuration, and add security logging.' },
    ],
  },
  {
    category: 'Performance',
    color: C.amber,
    icon: <Gauge size={14} color={C.amber} />,
    items: [
      { id: 'p1', category: 'Performance', tags: ['caching', 'redis'], title: 'Add caching layer', objective: 'Implement a caching strategy using Redis or in-memory caching. Cache expensive database queries, API responses, and computed values. Add cache invalidation on writes.' },
      { id: 'p2', category: 'Performance', tags: ['database', 'indexes'], title: 'Database optimization', objective: 'Optimize database performance by adding appropriate indexes, optimizing slow queries, implementing connection pooling, and adding query result pagination.' },
      { id: 'p3', category: 'Performance', tags: ['bundle', 'lazy-load'], title: 'Frontend bundle optimization', objective: 'Optimize frontend bundle size with code splitting, lazy loading, tree shaking, and asset optimization. Target a 50% reduction in initial load time.' },
    ],
  },
  {
    category: 'Architecture',
    color: C.purple,
    icon: <Layout size={14} color={C.purple} />,
    items: [
      { id: 'a1', category: 'Architecture', tags: ['microservices', 'api'], title: 'Extract microservices', objective: 'Identify bounded contexts and extract them into separate microservices. Define clear API contracts between services, add service discovery, and implement proper error handling across service boundaries.' },
      { id: 'a2', category: 'Architecture', tags: ['docker', 'containerize'], title: 'Containerize with Docker', objective: 'Add Docker containerization with production-ready Dockerfile, docker-compose for local development, environment variable management, and deployment scripts.' },
      { id: 'a3', category: 'Architecture', tags: ['events', 'messaging'], title: 'Event-driven architecture', objective: 'Refactor tightly coupled operations to use an event-driven pattern. Add an event bus, define domain events, and decouple components that currently communicate synchronously.' },
    ],
  },
  {
    category: 'Documentation',
    color: C.blue,
    icon: <BookOpen size={14} color={C.blue} />,
    items: [
      { id: 'd1', category: 'Documentation', tags: ['api', 'openapi'], title: 'OpenAPI / Swagger docs', objective: 'Generate comprehensive OpenAPI 3.0 documentation for all API endpoints. Include request/response schemas, authentication requirements, example payloads, and error codes.' },
      { id: 'd2', category: 'Documentation', tags: ['readme', 'setup'], title: 'Developer documentation', objective: 'Write thorough developer documentation including README, architecture diagrams, setup guide, contributing guidelines, and code comments for complex business logic.' },
      { id: 'd3', category: 'Documentation', tags: ['jsdoc', 'comments'], title: 'Code documentation pass', objective: 'Add JSDoc/TSDoc comments to all public functions, classes, and types. Document parameters, return values, thrown errors, and usage examples for all exported APIs.' },
    ],
  },
];

export default function TemplatesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const isSelecting = params.select === '1';

  const handleSelect = (template: Template) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isSelecting) {
      router.back();
      // Pass back via global state or URL param
      router.setParams({ selectedObjective: template.objective });
    } else {
      router.push({ pathname: '/launch' as RelativePathString, params: { objective: template.objective } });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Zap size={16} color={C.amber} />
            <View>
              <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>TEMPLATES</Text>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>
                {isSelecting ? 'Tap to use as objective' : '18 evolution patterns'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {TEMPLATES.map(section => (
          <View key={section.category} style={{ marginTop: 20 }}>
            {/* Category header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: section.color + '18', borderColor: section.color + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
                {section.icon}
              </View>
              <Text style={{ color: section.color, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>
                {section.category.toUpperCase()}
              </Text>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{section.items.length}</Text>
            </View>

            {/* Template cards */}
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              {section.items.map(template => (
                <Pressable
                  key={template.id}
                  onPress={() => handleSelect(template)}
                  style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12 }}
                  className="active:opacity-80"
                >
                  <View style={{ padding: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', flex: 1 }}>{template.title}</Text>
                      <ChevronRight size={14} color={C.muted} />
                    </View>
                    <Text style={{ color: C.muted, fontSize: 11, lineHeight: 17 }} numberOfLines={2}>
                      {template.objective}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      {template.tags.map(tag => (
                        <View key={tag} style={{ backgroundColor: section.color + '12', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: section.color, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
