import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface CategoryLabelProps {
  category: string | null;
  isLoading?: boolean;
}

export function CategoryLabel({ category, isLoading = false }: CategoryLabelProps) {
  if (isLoading || !category) {
    return (
      <Skeleton className="h-5 w-20 rounded-full" />
    );
  }

  const categoryColor = getCategoryColor(category);
  
  return (
    <Badge variant="outline" className={`${categoryColor} capitalize`}>
      {category.toLowerCase()}
    </Badge>
  );
}

function getCategoryColor(category: string): string {
  const colors: { [key: string]: string } = {
    'PRODUCTIVITY': 'bg-green-100 text-green-800 border-green-200',
    'COMMUNICATION': 'bg-blue-100 text-blue-800 border-blue-200',
    'DEVELOPMENT': 'bg-purple-100 text-purple-800 border-purple-200',
    'SECURITY': 'bg-red-100 text-red-800 border-red-200',
    'ANALYTICS': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'MARKETING': 'bg-pink-100 text-pink-800 border-pink-200',
    'FINANCE': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'HUMAN_RESOURCES': 'bg-orange-100 text-orange-800 border-orange-200',
    'UNCATEGORIZED': 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return colors[category.toUpperCase()] || colors['UNCATEGORIZED'];
} 