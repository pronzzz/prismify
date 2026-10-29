// Messy Java file for testing Prismify
// This file has poor variable names and inconsistent formatting

public class D {
    private String n;
    private int v;
    
    public D(String n,int v){
        this.n = n;
        this.v = v;
    }
    
    public int g(){
        return this.v * 2;
    }
    
    public static int calc(int a,int b,int c){
        int x = a + b;
        int y=x*c;
        int z = y / 2;
        
        if(z>10){
            int r = z - 10;
            System.out.println("Result: " + r);
            return r;
        }else{
            return z;
        }
    }
    
    public static int f(int[] arr){
        int s = 0;
        for(int i=0;i<arr.length;i++){
            s += arr[i];
        }
        return s;
    }
    
    public static void proc(User u){
        String n = u.getName();
        int a = u.getAge();
        String e = u.getEmail();
        
        System.out.println("Processing user: " + n);
        
        if(a < 18){
            System.out.println("Minor user");
            return;
        }
        
        System.out.println("Adult user: " + n);
    }
}
